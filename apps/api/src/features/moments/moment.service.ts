import { randomUUID } from "node:crypto";
import type {
  CreateMomentRequest,
  Moment,
  MomentPage,
  Occurrence,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import type { LocationRepository } from "../locations/location.repository.js";
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
import type { MomentRepository } from "./moment.repository.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination/cursor.js";

/**
 * Recording and reading Moments.
 *
 * A Moment is something that happened, at a time, recorded by one person. Its
 * place in history comes from when the experience happened, never from when it
 * was recorded: a Moment entered today for 2014 belongs in 2014, and nothing
 * that happens afterwards moves it.
 *
 * Every Moment is private to its author. That is not a placeholder for
 * authorization that has not been written — it is the whole audience model
 * until the social graph exists, and reads enforce it rather than assuming it.
 *
 * Nothing here changes a Moment after it is recorded. Corrections, adding and
 * removing media, reordering, and deletion are 5H-3.
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
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly moments: MomentRepository,
    private readonly uploads: UploadRepository,
    private readonly locations: LocationRepository,
    private readonly realWorldEvents: RealWorldEventRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Record a Moment.
   *
   * @param authorUserId - Who is recording it.
   * @param request - The caption, when it happened, how far from UTC they were,
   *   and the media in the order it should be shown.
   * @returns The Moment as recorded.
   * @throws {ValidationError} If the occurrence is incoherent, if there is no
   *   media or the same file appears twice, or if any file is missing, belongs
   *   to somebody else, or has not finished being checked.
   */
  async record(authorUserId: string, request: CreateMomentRequest): Promise<Moment> {
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

    await withTransaction(this.dataSource, (tx) =>
      this.moments.insert(tx, {
        momentId,
        authorUserId,
        caption: request.caption.trim(),
        occurrence: request.occurrence,
        occurrenceOffsetMinutes: request.occurrenceOffsetMinutes,
        media: positionMedia(request.uploadIds),
        createdAt: this.clock(),
      }),
    );

    await this.associate(momentId, request.locationId, request.realWorldEventIds);

    const recorded = await this.moments.findById(momentId);

    if (recorded === undefined) {
      throw new Error("A Moment was not found immediately after being recorded");
    }

    return recorded;
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
   * @returns The Moment as it now stands.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   * @throws {ValidationError} If there is no such place.
   */
  async setLocation(
    momentId: string,
    viewerUserId: string,
    locationId: string,
  ): Promise<Moment> {
    await this.get(momentId, viewerUserId);
    await this.checkContextExists(locationId, undefined);

    await withTransaction(this.dataSource, (tx) =>
      this.moments.setLocation(tx, momentId, locationId, this.clock()),
    );

    return this.get(momentId, viewerUserId);
  }

  /**
   * Take back where a Moment happened.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @returns The Moment as it now stands. Removing a place a Moment never had
   *   is not an error: the caller asked for a state that already holds.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async clearLocation(momentId: string, viewerUserId: string): Promise<Moment> {
    await this.get(momentId, viewerUserId);

    await withTransaction(this.dataSource, (tx) => this.moments.clearLocation(tx, momentId));

    return this.get(momentId, viewerUserId);
  }

  /**
   * Say a Moment was part of an occurrence.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param realWorldEventId - Which occurrence.
   * @returns The Moment as it now stands. Saying it twice is the same claim
   *   made twice, and leaves one association.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   * @throws {ValidationError} If there is no such occurrence.
   */
  async addRealWorldEvent(
    momentId: string,
    viewerUserId: string,
    realWorldEventId: string,
  ): Promise<Moment> {
    await this.get(momentId, viewerUserId);
    await this.checkContextExists(undefined, [realWorldEventId]);

    await withTransaction(this.dataSource, (tx) =>
      this.moments.addRealWorldEvent(tx, momentId, realWorldEventId, this.clock()),
    );

    return this.get(momentId, viewerUserId);
  }

  /**
   * Take back a Moment's association with an occurrence.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param realWorldEventId - Which occurrence.
   * @returns The Moment as it now stands.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async removeRealWorldEvent(
    momentId: string,
    viewerUserId: string,
    realWorldEventId: string,
  ): Promise<Moment> {
    await this.get(momentId, viewerUserId);

    await withTransaction(this.dataSource, (tx) =>
      this.moments.removeRealWorldEvent(tx, momentId, realWorldEventId),
    );

    return this.get(momentId, viewerUserId);
  }

  /**
   * Correct what a Moment says happened.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param caption - The corrected words.
   * @returns The Moment as it now stands. Its place in history is untouched:
   *   `moments.md:313` requires that editing descriptive text not move a Moment
   *   through chronological navigation.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async updateCaption(momentId: string, viewerUserId: string, caption: string): Promise<Moment> {
    const before = await this.get(momentId, viewerUserId);
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
    });

    return this.get(momentId, viewerUserId);
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
   * @returns The Moment as it now stands, in its corrected position.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   * @throws {ValidationError} If the corrected occurrence is incoherent.
   */
  async correctOccurrence(
    momentId: string,
    viewerUserId: string,
    occurrence: Occurrence,
    offsetMinutes: number,
  ): Promise<Moment> {
    const before = await this.get(momentId, viewerUserId);
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
    });

    return this.get(momentId, viewerUserId);
  }

  /**
   * Add media to a Moment, enriching what it already represents.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param uploadIds - The media to add, appended in the order given.
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
  ): Promise<Moment> {
    await this.get(momentId, viewerUserId);

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
    });

    return this.get(momentId, viewerUserId);
  }

  /**
   * Take a piece of media out of a Moment.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param uploadId - Which medium.
   * @returns The Moment as it now stands, its remaining media renumbered so the
   *   order stays dense.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   * @throws {ValidationError} If that medium is not part of the Moment, or is
   *   the last one — removing a medium is not deleting the Moment
   *   (`moments.md:436`), and a Moment without media could not have been
   *   created.
   */
  async removeMedium(momentId: string, viewerUserId: string, uploadId: string): Promise<Moment> {
    await this.get(momentId, viewerUserId);

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
    });

    return this.get(momentId, viewerUserId);
  }

  /**
   * Change the order a Moment shows its media in.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking. Only its author may.
   * @param uploadIds - Every medium the Moment has, in the order asked for.
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
  ): Promise<Moment> {
    await this.get(momentId, viewerUserId);

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
    });

    return this.get(momentId, viewerUserId);
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
   * @returns Nothing.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async delete(momentId: string, viewerUserId: string): Promise<void> {
    await this.get(momentId, viewerUserId);

    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      await this.moments.markDeleted(tx, momentId, at);
      await this.moments.recordEdit(tx, {
        momentId,
        editedByUserId: viewerUserId,
        kind: "deleted",
        previous: {},
        at,
      });
    });
  }

  /**
   * Read one Moment.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking.
   * @returns The Moment.
   * @throws {NotFoundError} If there is no such Moment, or it belongs to
   *   somebody else. The two are deliberately indistinguishable: telling a
   *   stranger that a Moment exists but is not theirs is itself a disclosure.
   */
  async get(momentId: string, viewerUserId: string): Promise<Moment> {
    const moment = await this.moments.findById(momentId);

    if (moment === undefined || moment.authorUserId !== viewerUserId) {
      throw new NotFoundError("No such moment");
    }

    return moment;
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
    const moments = await this.moments.findForAuthor(
      authorUserId,
      limit,
      decodeCursor(cursor),
    );

    // A full page means there is probably more; a short one means there is
    // not. Asking for one extra row to be certain would cost a row on every
    // page to save one empty request at the end.
    const last = moments.length === limit ? moments[moments.length - 1] : undefined;

    return {
      moments,
      ...(last === undefined ? {} : { nextCursor: encodeCursor(new Date(last.occurrence.start), last.momentId) }),
    };
  }
}
