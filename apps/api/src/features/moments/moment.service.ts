import { randomUUID } from "node:crypto";
import type { CreateMomentRequest, Moment, MomentPage } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
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
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly moments: MomentRepository,
    private readonly uploads: UploadRepository,
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
