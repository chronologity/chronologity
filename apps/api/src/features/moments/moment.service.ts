import { randomUUID } from "node:crypto";
import type {
  CreateMomentRequest,
  LocationDisclosure,
  Moment,
  MomentAudience,
  MomentPage,
  Occurrence,
  SetMomentVisibilityRequest,
} from "@chronologity/contracts";
import { MOMENTS_BOUNDARY } from "@chronologity/contracts";
import { disclosePlace } from "@chronologity/moment-access";
import type { DataSource } from "typeorm";
import { withTransaction, type Transaction } from "../../lib/database/transaction.js";
import { enqueueOutboxMessage } from "../../lib/database/outbox.js";
import { topicName } from "../../lib/messaging/topics.js";
import type { RequestContext } from "../../types/request-context.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import type { LocationRepository } from "../locations/location.repository.js";
import type { FollowRepository } from "../social/follow.repository.js";
import type { SavedViewRepository } from "../saved-views/saved-view.repository.js";
import type { UserRepository } from "../users/user.repository.js";
import type { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import type { UploadRepository } from "../uploads/upload.repository.js";
import {
  checkAddition,
  checkMedia,
  checkOccurrence,
  checkRemoval,
  checkReorder,
  describeAdditionRejection,
  describeMediaRejection,
  describeOccurrenceRejection,
  describeRemovalRejection,
  describeReorderRejection,
  positionMedia,
} from "./moment.policy.js";
import type { ErasureRepository } from "../privacy/erasure.repository.js";
import type { MomentCommentRepository } from "./moment-comment.repository.js";
import type { MomentRepository } from "./moment.repository.js";
import type { UndisclosedMoment } from "./moment.types.js";
import { isAdult } from "../moderation/moderation.policy.js";
import type { ModerationRepository } from "../moderation/moderation.repository.js";
import { checkVisibility, type ViewFacts } from "./moment.visibility-policy.js";
import { generateId } from "../../lib/ids/generate-id.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination/cursor.js";

/**
 * Recording and reading Moments.
 *
 * A Moment is something that happened, at a time, recorded by one person. Its
 * place in history comes from when the experience happened, never from when it
 * was recorded: a Moment entered today for 2014 belongs in 2014, and nothing
 * that happens afterwards moves it.
 *
 * A Moment has an audience: private to its author, restricted to people they
 * named, or public to any Viewer a Block does not separate them from. Reads
 * enforce that rather than assuming it, and every refusal is reported as a
 * Moment that does not exist.
 *
 * Reading and editing are gated separately on purpose. `get` admits anybody a
 * Moment is visible to; `getForAuthor` admits only whoever wrote it, and every
 * change goes through that one. Sharing a single gate would have meant everybody
 * who could see a Moment could rewrite it.
 */
export class MomentService {
  /**
   * Build the Moment service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param moments - Where Moments are stored.
   * @param uploads - Used to check that media exists, belongs to the author,
   *   and has actually been opened by a decoder.
   * @param locations - Used to check that a place named actually exists.
   * @param realWorldEvents - Used to check that an occurrence named actually
   *   exists. Unlike media, neither has to belong to the author: a Location is
   *   shared reference data and an Event is shared history.
   * @param follows - Used to ask whether a Block separates two people, which
   *   refuses a read before visibility is even consulted.
   * @param users - Used to check that everybody named in an audience exists.
   * @param moderation - Used to ask what Chronologity has decided about a
   *   Moment, whether its author is suspended, and whether the Viewer is old
   *   enough for age-restricted content.
   * @param comments - Used to blank every comment on a Moment when it is
   *   deleted, whoever wrote it.
   * @param erasures - Where the request to finish a deletion is recorded.
   *   Optional, and absent a deletion marks the Moment and erases nothing
   *   further — which is what this service did before erasure existed, and is
   *   the right behaviour for a process with no worker behind it.
   * @param clock - Injected so tests can move time without waiting.
   * @param savedViews - Optional. Narrowing a Moment's audience takes it out of
   *   sight of whoever was dropped, so any count of what is new in their saved
   *   views is forgotten in the same transaction.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly moments: MomentRepository,
    private readonly uploads: UploadRepository,
    private readonly locations: LocationRepository,
    private readonly realWorldEvents: RealWorldEventRepository,
    private readonly follows: FollowRepository,
    private readonly users: UserRepository,
    private readonly moderation: ModerationRepository,
    private readonly comments: MomentCommentRepository,
    private readonly erasures?: ErasureRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly savedViews?: SavedViewRepository,
  ) {}

  /**
   * Record a Moment.
   *
   * @param authorUserId - Who is recording it.
   * @param request - The caption, when it happened, how far from UTC they were,
   *   and the media in the order it should be shown.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as recorded.
   * @throws {ValidationError} If the occurrence is incoherent, if there is no
   *   media or the same file appears twice, or if any file is missing, belongs
   *   to somebody else, or has not finished being checked.
   */
  async record(
    authorUserId: string,
    request: CreateMomentRequest,
    context: RequestContext,
  ): Promise<Moment> {
    const occurrenceRejection = checkOccurrence(request.occurrence);

    if (occurrenceRejection !== undefined) {
      throw new ValidationError(describeOccurrenceRejection(occurrenceRejection), {
        field: "occurrence",
      });
    }

    const mediaRejection = checkMedia(request.uploadIds);

    if (mediaRejection !== undefined) {
      throw new ValidationError(describeMediaRejection(mediaRejection), { field: "uploadIds" });
    }

    await this.checkEveryFileIsUsable(authorUserId, request.uploadIds);
    await this.checkContextExists(request.locationId, request.realWorldEventIds);

    const momentId = randomUUID();

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.insert(tx, {
        momentId,
        authorUserId,
        caption: request.caption.trim(),
        occurrence: request.occurrence,
        occurrenceOffsetMinutes: request.occurrenceOffsetMinutes,
        media: positionMedia(request.uploadIds),
        visibility: request.visibility,
        locationDisclosure: request.locationDisclosure,
        createdAt: this.clock(),
      });
      await this.announce(
        tx,
        "MomentRecorded",
        momentId,
        authorUserId,
        { recordedAt: this.clock().toISOString() },
        context,
      );
    });

    await this.associate(momentId, request.locationId, request.realWorldEventIds);

    const recorded = await this.moments.findById(momentId);

    if (recorded === undefined) {
      throw new Error("A Moment was not found immediately after being recorded");
    }

    return this.disclose(recorded, authorUserId);
  }

  /**
   * Check that every file named can actually represent this person's Moment.
   *
   * Three questions, deliberately answered with one message. Whether a file
   * does not exist, belongs to somebody else, or is simply not ready is not
   * information a stranger should be able to extract by guessing identifiers.
   *
   * @param authorUserId - Who is recording the Moment.
   * @param uploadIds - The files named.
   * @returns Nothing when every file is usable.
   * @throws {ValidationError} Naming the first file that is not.
   */
  private async checkEveryFileIsUsable(
    authorUserId: string,
    uploadIds: readonly string[],
  ): Promise<void> {
    for (const uploadId of uploadIds) {
      const upload = await this.uploads.findRecord(uploadId);

      if (upload === undefined || upload.ownerUserId !== authorUserId) {
        throw new ValidationError("No such upload", { field: "uploadIds" });
      }

      // `ready` is reached only after a decoder has opened the file and found
      // it to be what it claimed (ADR-086). Media is mandatory, so a Moment
      // built on a file that later fails checking would be a Moment that could
      // not have been created.
      if (upload.status !== "ready") {
        throw new ValidationError("An upload is not ready to be part of a moment", {
          field: "uploadIds",
        });
      }
    }
  }

  /**
   * Attach the context a Moment was created with.
   *
   * Separate from the Moment's own write, because the Moment is complete
   * without it: `locations.md` is explicit that a Moment need not have a place,
   * and an Event association is optional too. A failure here leaves a Moment
   * that exists and lacks context, which is a truthful state.
   *
   * @param momentId - The Moment just recorded.
   * @param locationId - Where it happened, if anybody said.
   * @param realWorldEventIds - What it was part of, if anything.
   * @returns Nothing.
   */
  private async associate(
    momentId: string,
    locationId: string | undefined,
    realWorldEventIds: readonly string[] | undefined,
  ): Promise<void> {
    const events = [...new Set(realWorldEventIds ?? [])];

    if (locationId === undefined && events.length === 0) {
      return;
    }

    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      if (locationId !== undefined) {
        await this.moments.setLocation(tx, momentId, locationId, at);
      }

      for (const realWorldEventId of events) {
        await this.moments.addRealWorldEvent(tx, momentId, realWorldEventId, at);
      }
    });
  }

  /**
   * Check that the context a Moment claims actually exists.
   *
   * Neither has to belong to the caller. A Location is shared reference data
   * (ADR-098) and an Event is shared history whose creator holds provenance
   * rather than ownership — so pointing at somebody else's is not trespass, it
   * is the entire point of both being shared.
   *
   * @param locationId - Where it happened, if anybody said.
   * @param realWorldEventIds - What it was part of, if anything.
   * @returns Nothing when everything named exists.
   * @throws {ValidationError} Naming the first thing that does not. Refused
   *   rather than dropped: silently discarding it would record a Moment
   *   claiming less than the person said.
   */
  private async checkContextExists(
    locationId: string | undefined,
    realWorldEventIds: readonly string[] | undefined,
  ): Promise<void> {
    if (locationId !== undefined && (await this.locations.findById(locationId)) === undefined) {
      throw new ValidationError("No such location", { field: "locationId" });
    }

    for (const realWorldEventId of new Set(realWorldEventIds ?? [])) {
      if ((await this.realWorldEvents.findById(realWorldEventId)) === undefined) {
        throw new ValidationError("No such real-world event", { field: "realWorldEventIds" });
      }
    }
  }

  /**
   * Say where a Moment happened, replacing whatever was said before.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param locationId - Which place.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as it now stands.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   * @throws {ValidationError} If there is no such place.
   */
  async setLocation(
    momentId: string,
    viewerUserId: string,
    locationId: string,
    context: RequestContext,
  ): Promise<Moment> {
    await this.getForAuthor(momentId, viewerUserId);
    await this.checkContextExists(locationId, undefined);

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.setLocation(tx, momentId, locationId, this.clock());
      await this.announce(
        tx,
        "MomentRevised",
        momentId,
        viewerUserId,
        { kind: "location", revisedAt: this.clock().toISOString() },
        context,
      );
    });

    return this.getForAuthor(momentId, viewerUserId);
  }

  /**
   * Take back where a Moment happened.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as it now stands. Removing a place a Moment never had
   *   is not an error: the caller asked for a state that already holds.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async clearLocation(
    momentId: string,
    viewerUserId: string,
    context: RequestContext,
  ): Promise<Moment> {
    await this.getForAuthor(momentId, viewerUserId);

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.clearLocation(tx, momentId);
      await this.announce(
        tx,
        "MomentRevised",
        momentId,
        viewerUserId,
        { kind: "location", revisedAt: this.clock().toISOString() },
        context,
      );
    });

    return this.getForAuthor(momentId, viewerUserId);
  }

  /**
   * Say a Moment was part of an occurrence.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param realWorldEventId - Which occurrence.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as it now stands. Saying it twice is the same claim
   *   made twice, and leaves one association.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   * @throws {ValidationError} If there is no such occurrence.
   */
  async addRealWorldEvent(
    momentId: string,
    viewerUserId: string,
    realWorldEventId: string,
    context: RequestContext,
  ): Promise<Moment> {
    await this.getForAuthor(momentId, viewerUserId);
    await this.checkContextExists(undefined, [realWorldEventId]);

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.addRealWorldEvent(tx, momentId, realWorldEventId, this.clock());
      await this.announce(
        tx,
        "MomentRevised",
        momentId,
        viewerUserId,
        { kind: "real_world_events", revisedAt: this.clock().toISOString() },
        context,
      );
    });

    return this.getForAuthor(momentId, viewerUserId);
  }

  /**
   * Take back a Moment's association with an occurrence.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param realWorldEventId - Which occurrence.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as it now stands.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async removeRealWorldEvent(
    momentId: string,
    viewerUserId: string,
    realWorldEventId: string,
    context: RequestContext,
  ): Promise<Moment> {
    await this.getForAuthor(momentId, viewerUserId);

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.removeRealWorldEvent(tx, momentId, realWorldEventId);
      await this.announce(
        tx,
        "MomentRevised",
        momentId,
        viewerUserId,
        { kind: "real_world_events", revisedAt: this.clock().toISOString() },
        context,
      );
    });

    return this.getForAuthor(momentId, viewerUserId);
  }

  /**
   * Correct what a Moment says happened.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param caption - The corrected words.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as it now stands. Its place in history is untouched:
   *   `moments.md:313` requires that editing descriptive text not move a Moment
   *   through chronological navigation.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async updateCaption(
    momentId: string,
    viewerUserId: string,
    caption: string,
    context: RequestContext,
  ): Promise<Moment> {
    const before = await this.getForAuthor(momentId, viewerUserId);
    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.updateCaption(tx, momentId, caption.trim(), at);
      await this.moments.recordEdit(tx, {
        momentId,
        editedByUserId: viewerUserId,
        kind: "caption_changed",
        previous: { caption: before.caption },
        at,
      });
      await this.announce(
        tx,
        "MomentRevised",
        momentId,
        viewerUserId,
        { kind: "caption", revisedAt: at.toISOString() },
        context,
      );
    });

    return this.getForAuthor(momentId, viewerUserId);
  }

  /**
   * Move a Moment to where it actually belongs in history.
   *
   * Its own operation rather than part of a general update, because it is not
   * the same act: `moments.md:443` calls this "a historical correction rather
   * than an ordinary cosmetic edit", and it may move the Moment through
   * chronological navigation.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param occurrence - The corrected interval and precision.
   * @param offsetMinutes - The corrected offset from UTC.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as it now stands, in its corrected position.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   * @throws {ValidationError} If the corrected occurrence is incoherent.
   */
  async correctOccurrence(
    momentId: string,
    viewerUserId: string,
    occurrence: Occurrence,
    offsetMinutes: number,
    context: RequestContext,
  ): Promise<Moment> {
    const before = await this.getForAuthor(momentId, viewerUserId);
    const rejection = checkOccurrence(occurrence);

    if (rejection !== undefined) {
      throw new ValidationError(describeOccurrenceRejection(rejection), { field: "occurrence" });
    }

    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.updateOccurrence(tx, momentId, occurrence, offsetMinutes, at);
      await this.moments.recordEdit(tx, {
        momentId,
        editedByUserId: viewerUserId,
        kind: "occurrence_corrected",
        // Where it used to sit. Without this a correction leaves no trace of
        // what history it is a correction to.
        previous: {
          occurrence: before.occurrence,
          occurrenceOffsetMinutes: before.occurrenceOffsetMinutes,
        },
        at,
      });
      await this.announce(
        tx,
        "MomentRevised",
        momentId,
        viewerUserId,
        { kind: "occurrence", revisedAt: at.toISOString() },
        context,
      );
    });

    return this.getForAuthor(momentId, viewerUserId);
  }

  /**
   * Add media to a Moment, enriching what it already represents.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param uploadIds - The media to add, appended in the order given.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as it now stands. Its occurrence is untouched: adding
   *   media "should not automatically create a new Moment or change the
   *   existing Moment's chronological position" (`moments.md:415`).
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   * @throws {ValidationError} If any file is missing, belongs to somebody else,
   *   is not ready, or is already part of this Moment.
   */
  async addMedia(
    momentId: string,
    viewerUserId: string,
    uploadIds: readonly string[],
    context: RequestContext,
  ): Promise<Moment> {
    await this.getForAuthor(momentId, viewerUserId);

    const present = await this.moments.findMediaOrder(momentId);
    const mediaRejection = checkMedia(uploadIds);

    if (mediaRejection !== undefined) {
      throw new ValidationError(describeMediaRejection(mediaRejection), { field: "uploadIds" });
    }

    const additionRejection = checkAddition(uploadIds, present);

    if (additionRejection !== undefined) {
      throw new ValidationError(describeAdditionRejection(), { field: "uploadIds" });
    }

    await this.checkEveryFileIsUsable(viewerUserId, uploadIds);

    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.replaceMedia(tx, momentId, [...present, ...uploadIds], at);
      await this.moments.recordEdit(tx, {
        momentId,
        editedByUserId: viewerUserId,
        kind: "media_added",
        previous: { uploadIds: present },
        at,
      });
      await this.announce(
        tx,
        "MomentRevised",
        momentId,
        viewerUserId,
        { kind: "media", revisedAt: at.toISOString() },
        context,
      );
    });

    return this.getForAuthor(momentId, viewerUserId);
  }

  /**
   * Take a piece of media out of a Moment.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param uploadId - Which medium.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as it now stands, its remaining media renumbered so the
   *   order stays dense.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   * @throws {ValidationError} If that medium is not part of the Moment, or is
   *   the last one — removing a medium is not deleting the Moment
   *   (`moments.md:436`), and a Moment without media could not have been
   *   created.
   */
  async removeMedium(
    momentId: string,
    viewerUserId: string,
    uploadId: string,
    context: RequestContext,
  ): Promise<Moment> {
    await this.getForAuthor(momentId, viewerUserId);

    const present = await this.moments.findMediaOrder(momentId);
    const rejection = checkRemoval(uploadId, present);

    if (rejection !== undefined) {
      throw new ValidationError(describeRemovalRejection(rejection), { field: "uploadId" });
    }

    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.replaceMedia(
        tx,
        momentId,
        present.filter((present) => present !== uploadId),
        at,
      );
      await this.moments.recordEdit(tx, {
        momentId,
        editedByUserId: viewerUserId,
        kind: "media_removed",
        previous: { uploadIds: present },
        at,
      });
      await this.announce(
        tx,
        "MomentRevised",
        momentId,
        viewerUserId,
        { kind: "media", revisedAt: at.toISOString() },
        context,
      );
    });

    return this.getForAuthor(momentId, viewerUserId);
  }

  /**
   * Change the order a Moment shows its media in.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param uploadIds - Every medium the Moment has, in the order asked for.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as it now stands. Presentation only: reordering never
   *   moves a Moment through chronology (`moments.md:157`).
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   * @throws {ValidationError} If the list is not exactly the media already
   *   there — a reorder that adds or drops something is an addition or a
   *   removal, and each has rules this operation does not apply.
   */
  async reorderMedia(
    momentId: string,
    viewerUserId: string,
    uploadIds: readonly string[],
    context: RequestContext,
  ): Promise<Moment> {
    await this.getForAuthor(momentId, viewerUserId);

    const present = await this.moments.findMediaOrder(momentId);
    const rejection = checkReorder(uploadIds, present);

    if (rejection !== undefined) {
      throw new ValidationError(describeReorderRejection(), { field: "uploadIds" });
    }

    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.replaceMedia(tx, momentId, uploadIds, at);
      await this.moments.recordEdit(tx, {
        momentId,
        editedByUserId: viewerUserId,
        kind: "media_reordered",
        previous: { uploadIds: present },
        at,
      });
      await this.announce(
        tx,
        "MomentRevised",
        momentId,
        viewerUserId,
        { kind: "media", revisedAt: at.toISOString() },
        context,
      );
    });

    return this.getForAuthor(momentId, viewerUserId);
  }

  /**
   * Take a Moment out of ordinary access.
   *
   * A tombstone rather than an erasure. The row and its media stay; every read
   * stops returning it. What must eventually be erased, and what must be
   * retained for abuse or legal reasons, is deliberately unresolved
   * (`moments.md:451`) and is not decided here.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns Nothing.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async delete(momentId: string, viewerUserId: string, context: RequestContext): Promise<void> {
    await this.getForAuthor(momentId, viewerUserId);

    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      // Marking blanks the caption, and this blanks every comment on it. Both
      // happen now rather than when the erasure worker runs, so that what is
      // waiting in a queue is structure rather than anybody's words.
      await this.moments.markDeleted(tx, momentId, at);
      await this.comments.blankAllForMoment(tx, momentId, at);
      await this.moments.recordEdit(tx, {
        momentId,
        editedByUserId: viewerUserId,
        kind: "deleted",
        previous: {},
        at,
      });

      // In the same transaction as the deletion itself. A Moment cannot be
      // marked deleted without the request that finishes the job: the media is
      // in object storage and the document is in the index, and neither goes
      // until somebody walks the rest of the path.
      await this.erasures?.request(tx, {
        requestId: generateId(),
        subjectType: "moment",
        subjectId: momentId,
        at,
      });

      await this.announce(
        tx,
        "MomentRemoved",
        momentId,
        viewerUserId,
        { removedAt: at.toISOString() },
        context,
      );
    });
  }

  /**
   * Read one Moment, proving the caller wrote it.
   *
   * The gate on every change. Kept separate from `get` deliberately: that one
   * admits anybody a Moment is visible to, and if editing shared it, everybody
   * who could see a Moment could rewrite it.
   *
   * @param momentId - Which Moment.
   * @param authorUserId - Who is asking. Only its author passes.
   * @returns The Moment.
   * @throws {NotFoundError} If there is no such Moment, or it belongs to
   *   somebody else. The two are deliberately indistinguishable: telling a
   *   stranger that a Moment exists but is not theirs is itself a disclosure.
   */
  async getForAuthor(momentId: string, authorUserId: string): Promise<Moment> {
    const moment = await this.moments.findById(momentId);

    if (moment === undefined || moment.authorUserId !== authorUserId) {
      throw new NotFoundError("No such moment");
    }

    return this.disclose(moment, authorUserId);
  }

  /**
   * Read one Moment as whoever is asking.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking.
   * @returns The Moment.
   * @throws {NotFoundError} If there is no such Moment, or this Viewer may not
   *   see it. Every refusal is reported this way, whatever the reason: that a
   *   Moment exists, that it is private, that its author blocked you, and that
   *   you were left off a list are all disclosures in their own right, and a
   *   distinguishable refusal would leak whichever one applied.
   */
  async get(momentId: string, viewerUserId: string): Promise<Moment> {
    const moment = await this.moments.findById(momentId);

    if (moment === undefined) {
      throw new NotFoundError("No such moment");
    }

    // Looked up only when the answer could depend on them. The author's own
    // Moment is decided by the policy before any of them matters, which is what
    // keeps a suspended person's history readable to them.
    const facts =
      moment.authorUserId === viewerUserId
        ? {
            blockedEitherWay: false,
            inAudience: false,
            authorSuspended: false,
            moderationState: undefined,
            viewerIsAdult: true,
          }
        : await this.gatherViewFacts(
            momentId,
            moment.authorUserId,
            moment.visibility,
            viewerUserId,
          );

    if (checkVisibility(viewerUserId, moment, facts) !== undefined) {
      throw new NotFoundError("No such moment");
    }

    return this.disclose(moment, viewerUserId);
  }

  /**
   * Everything the visibility rule needs about somebody who is not the author.
   *
   * @param momentId - Which Moment.
   * @param authorUserId - Who wrote it.
   * @param visibility - What its author chose.
   * @param viewerUserId - Who is asking.
   * @returns The facts, each looked up only where it could change the answer.
   *   The audience is read whenever the Moment is restricted or moderation has
   *   narrowed it, since either can make membership decisive.
   */
  private async gatherViewFacts(
    momentId: string,
    authorUserId: string,
    visibility: string,
    viewerUserId: string,
  ): Promise<ViewFacts> {
    const state = (await this.moderation.findState("moment", momentId))?.state as
      ViewFacts["moderationState"] | undefined;

    return {
      blockedEitherWay: await this.isBlocked(authorUserId, viewerUserId),
      inAudience:
        (visibility === "restricted" || state === "restricted_to_authorized_audience") &&
        (await this.moments.isInAudience(momentId, viewerUserId)),
      authorSuspended: await this.moderation.isSuspended(authorUserId),
      moderationState: state,
      viewerIsAdult: await this.viewerIsAdult(viewerUserId),
    };
  }

  /**
   * Whether the Viewer is old enough for age-restricted content.
   *
   * Public because the relationship service needs the same answer for the same
   * Viewer, and asking the Moment service for it keeps one definition of what
   * "old enough" means rather than two that can drift apart.
   *
   * @param viewerUserId - Who is asking.
   * @returns Whether they have reached eighteen. False when no birthdate can be
   *   found for them, since ambiguous security-sensitive state defaults to
   *   deny.
   */
  async viewerIsAdult(viewerUserId: string): Promise<boolean> {
    return isAdult(await this.moderation.findDateOfBirth(viewerUserId), this.clock());
  }

  /**
   * Tell the rest of the system that a Moment changed.
   *
   * Enqueued in the caller's transaction, so the event and the change it
   * describes commit together or not at all. Nothing is published
   * automatically: every call site constructs its own, which is what keeps the
   * external contract a deliberate decision rather than a mirror of internal
   * history.
   *
   * The payload names the Moment and nothing about it. A consumer that needs
   * the caption reads authoritative state, which is what lets a message
   * replayed long afterwards produce a current answer instead of resurrecting a
   * stale one.
   *
   * @param tx - The caller's transaction.
   * @param eventType - Which of the Moment events this is.
   * @param momentId - Which Moment.
   * @param authorUserId - Whose it is, carried so a consumer knows whom this
   *   concerns without a read.
   * @param extra - Anything the specific event adds beyond the two identifiers.
   * @param context - The request that caused it, so the hop into asynchronous
   *   processing stays joined to it. Absent where no request did — a rebuild,
   *   or a test driving the service directly — and a trace is minted so the
   *   message is still followable on its own.
   * @returns Nothing.
   */
  private async announce(
    tx: Transaction,
    eventType: string,
    momentId: string,
    authorUserId: string,
    extra: Record<string, unknown>,
    context: RequestContext,
  ): Promise<void> {
    const traceId = context.traceId;

    await enqueueOutboxMessage(tx, {
      topic: topicName(MOMENTS_BOUNDARY),
      // Ordered per Moment: two notes about the same history must not be
      // handled out of sequence.
      partitionKey: momentId,
      aggregateType: "moment",
      aggregateId: momentId,
      aggregateVersion: 0,
      eventType,
      eventVersion: 1,
      payload: { momentId, authorUserId, ...extra },
      metadata: {
        traceId,
        correlationId: traceId,
        causationId: undefined,
        actorUserId: authorUserId,
        eventVersion: 1,
        recordedAt: context.receivedAt.toISOString(),
      },
    });
  }

  /**
   * Whether a Block separates two people, whichever of them set it.
   *
   * @param oneUserId - One of them.
   * @param otherUserId - The other.
   * @returns Whether either has blocked the other. Both directions count: an
   *   asymmetric rule would leave the blocker still reading the history of
   *   somebody they wanted nothing to do with, and would let the blocked person
   *   infer the Block from access that continued only one way.
   */
  private async isBlocked(oneUserId: string, otherUserId: string): Promise<boolean> {
    const blocks = await this.follows.blocksBetween(oneUserId, otherUserId);

    return blocks.iBlockedThem || blocks.theyBlockedMe;
  }

  /**
   * Read a page of one person's Moments as this Viewer may see them.
   *
   * @param authorUserId - Whose Moments.
   * @param viewerUserId - Who is asking. Asking for your own returns everything,
   *   the same as `list`.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page, and where the next one continues from when there is
   *   more. Pages are full rather than thinned: what a Viewer may not see is
   *   excluded by the query, not removed from the result.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async listForViewer(
    authorUserId: string,
    viewerUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<MomentPage> {
    const moments = await this.moments.findForAuthorAsViewer(
      authorUserId,
      viewerUserId,
      await this.viewerIsAdult(viewerUserId),
      limit,
      decodeCursor(cursor),
    );

    const last = moments.length === limit ? moments[moments.length - 1] : undefined;

    return {
      moments: moments.map((moment) => this.disclose(moment, viewerUserId)),
      ...(last === undefined
        ? {}
        : { nextCursor: encodeCursor(new Date(last.occurrence.start), last.momentId) }),
    };
  }

  /**
   * Reduce a Moment's place to what one Viewer may be told.
   *
   * Every read goes through here. The repository deliberately cannot produce a
   * `Moment` at all — it returns an `UndisclosedMoment` carrying the place
   * whole — so a read path that forgot this would fail to compile rather than
   * quietly hand somebody an exact position.
   *
   * @param moment - As stored, with its place not yet reduced.
   * @param viewerUserId - Who is asking.
   * @returns The Moment as that Viewer may receive it.
   */
  private disclose(moment: UndisclosedMoment, viewerUserId: string): Moment {
    const { location, locationDisclosure, ...rest } = moment;

    return {
      ...rest,
      place: disclosePlace(viewerUserId, moment.authorUserId, locationDisclosure, location),
    };
  }

  /**
   * Set whether a Moment may be offered to somebody who did not ask for it.
   *
   * Separate from visibility, and deliberately so. Unlisting leaves a Moment
   * reachable by anybody holding the link and takes it out of every
   * recommendation surface — `discovery.md:123` distinguishes being accessible
   * from being eligible for recommendation, and this is the control that makes
   * the distinction usable rather than theoretical.
   *
   * @param momentId - Which Moment.
   * @param authorUserId - Who is asking. Only its author may.
   * @param discoverable - Whether it may be recommended.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as it now stands.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async setDiscoverable(
    momentId: string,
    authorUserId: string,
    discoverable: boolean,
    context: RequestContext,
  ): Promise<Moment> {
    await this.getForAuthor(momentId, authorUserId);

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.setDiscoverable(tx, momentId, discoverable, this.clock());
      // A revision rather than a visibility change: who may see it has not
      // moved. What changed is whether Chronologity may put it in front of
      // somebody, which derived state has to learn either way.
      await this.announce(
        tx,
        "MomentRevised",
        momentId,
        authorUserId,
        { kind: "interaction_settings", revisedAt: this.clock().toISOString() },
        context,
      );
    });

    return this.getForAuthor(momentId, authorUserId);
  }

  /**
   * Set who may see a Moment, and who is named on it.
   *
   * @param momentId - Which Moment.
   * @param authorUserId - Who is asking. Only its author may.
   * @param request - The visibility, and the audience when it is restricted.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as it now stands.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   * @throws {ValidationError} If the audience names somebody who does not
   *   exist, or names its own author.
   */
  async setVisibility(
    momentId: string,
    authorUserId: string,
    request: SetMomentVisibilityRequest,
    context: RequestContext,
  ): Promise<Moment> {
    await this.getForAuthor(momentId, authorUserId);

    const audience: string[] = [...new Set(request.audience ?? [])];

    if (audience.includes(authorUserId)) {
      // Their own history is already theirs. Accepting it would put a row in
      // the list that no rule ever consults, and suggest the author's access
      // depended on it.
      throw new ValidationError("You do not need to name yourself", { field: "audience" });
    }

    await this.checkEveryoneExists(audience);

    await withTransaction(this.dataSource, async (tx) => {
      // Read before it is replaced. Whoever was named and no longer is has just
      // lost sight of this Moment, and any count of what is new in their saved
      // views now includes something they may not open.
      const dropped = (await this.moments.audienceIds(tx, momentId)).filter(
        (userId) => !audience.includes(userId),
      );

      await this.moments.setVisibility(tx, momentId, request.visibility, audience, this.clock());
      // Only those who lost sight. Somebody newly named gains history, which
      // makes their count too low — under-reporting, which is the safe
      // direction and something the sweep corrects in its own time.
      await this.savedViews?.forgetFor(tx, dropped);
      await this.announce(
        tx,
        "MomentVisibilityChanged",
        momentId,
        authorUserId,
        { visibility: request.visibility, changedAt: this.clock().toISOString() },
        context,
      );
    });

    return this.getForAuthor(momentId, authorUserId);
  }

  /**
   * Refuse an audience naming somebody who does not exist.
   *
   * @param userIds - Who was named.
   * @returns Nothing.
   * @throws {ValidationError} If any of them has no account, naming the first
   *   such identifier so the caller can find it.
   */
  private async checkEveryoneExists(userIds: readonly string[]): Promise<void> {
    for (const userId of userIds) {
      if ((await this.users.findPublic(userId)) === undefined) {
        throw new ValidationError(`No such user: ${userId}`, { field: "audience" });
      }
    }
  }

  /**
   * Set how much of a Moment's place other people are told.
   *
   * @param momentId - Which Moment.
   * @param authorUserId - Who is asking. Only its author may.
   * @param disclosure - How much to tell everybody else.
   * @param context - The request that caused this, so the hop into
   *   asynchronous indexing stays joined to it. Absent where no request did.
   * @returns The Moment as it now stands, which for its author always carries
   *   the exact place whatever they just chose for other people.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async setLocationDisclosure(
    momentId: string,
    authorUserId: string,
    disclosure: LocationDisclosure,
    context: RequestContext,
  ): Promise<Moment> {
    await this.getForAuthor(momentId, authorUserId);

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.setLocationDisclosure(tx, momentId, disclosure, this.clock());
      await this.announce(
        tx,
        "MomentRevised",
        momentId,
        authorUserId,
        { kind: "location", revisedAt: this.clock().toISOString() },
        context,
      );
    });

    return this.getForAuthor(momentId, authorUserId);
  }

  /**
   * Read who may see a restricted Moment.
   *
   * @param momentId - Which Moment.
   * @param authorUserId - Who is asking. Only its author may: a list of the
   *   people trusted with something is itself something to be trusted with.
   * @returns The people named.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async audience(momentId: string, authorUserId: string): Promise<MomentAudience> {
    await this.getForAuthor(momentId, authorUserId);

    return { users: await this.moments.findAudience(momentId) };
  }

  /**
   * Read a page of somebody's own Moments, most recent occurrence first.
   *
   * @param authorUserId - Whose Moments. Always the caller: there is no way to
   *   ask for anybody else's.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page, and where the next one continues from when there is
   *   more. The absence of a cursor is how a caller knows it has reached the
   *   end.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async list(authorUserId: string, limit: number, cursor?: string): Promise<MomentPage> {
    const moments = await this.moments.findForAuthor(authorUserId, limit, decodeCursor(cursor));

    // A full page means there is probably more; a short one means there is
    // not. Asking for one extra row to be certain would cost a row on every
    // page to save one empty request at the end.
    const last = moments.length === limit ? moments[moments.length - 1] : undefined;

    return {
      moments: moments.map((moment) => this.disclose(moment, authorUserId)),
      ...(last === undefined
        ? {}
        : { nextCursor: encodeCursor(new Date(last.occurrence.start), last.momentId) }),
    };
  }
}
