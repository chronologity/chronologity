import { randomUUID } from "node:crypto";
import type { CreateMomentRequest, Moment, MomentPage } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import type { LocationRepository } from "../locations/location.repository.js";
import type { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import type { UploadRepository } from "../uploads/upload.repository.js";
import {
  checkMedia,
  checkOccurrence,
  describeMediaRejection,
  describeOccurrenceRejection,
  positionMedia,
} from "./moment.policy.js";
import type { MomentRepository } from "./moment.repository.js";
import { decodeCursor, encodeCursor } from "./moment.cursor.js";

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
      cursor === undefined ? undefined : decodeCursor(cursor),
    );

    // A full page means there is probably more; a short one means there is
    // not. Asking for one extra row to be certain would cost a row on every
    // page to save one empty request at the end.
    const last = moments.length === limit ? moments[moments.length - 1] : undefined;

    return {
      moments,
      ...(last === undefined ? {} : { nextCursor: encodeCursor(last) }),
    };
  }
}
