import type { Moment as MomentContract, TemporalPrecision } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { IsNull } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import type { Upload as UploadRow } from "../uploads/upload.model.js";
import { toUpload } from "../uploads/upload.repository.js";
import { Moment as MomentRow, MomentMedium } from "./moment.model.js";
import type { MomentCursor, NewMoment } from "./moment.types.js";

/**
 * Where Moments are stored.
 *
 * PostgreSQL is the authority (ADR-092): what is written here is the record.
 *
 * Reads take the DataSource and writes take a transaction. A Moment and its
 * media are one record written two ways, and half of it committing would be a
 * Moment that could not have been created — media is mandatory.
 *
 * The entity is imported as `MomentRow` because `Moment` is the contract this
 * returns, and the two are deliberately different shapes.
 */

/**
 * Shape a row and its media into the boundary contract.
 *
 * @param row - As read from `moments`, with media and their uploads loaded.
 * @returns The Moment as a caller receives it, media in presentation order.
 */
function toMoment(row: MomentRow): MomentContract {
  const media = [...(row.media ?? [])]
    .sort((one, other) => one.position - other.position)
    .map((medium) => medium.upload)
    .filter((upload): upload is UploadRow => upload !== undefined)
    .map(toUpload);

  return {
    momentId: row.momentId,
    authorUserId: row.authorUserId,
    caption: row.caption,
    occurrence: {
      start: row.occurrenceStart.toISOString(),
      end: row.occurrenceEnd.toISOString(),
      precision: row.occurrencePrecision as TemporalPrecision,
    },
    occurrenceOffsetMinutes: row.occurrenceOffsetMinutes,
    media,
    visibility: "private",
    createdAt: row.createdAt.toISOString(),
  };
}

/** Reads and writes Moments. */
export class MomentRepository {
  /**
   * Build the Moment repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction of their own.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Record a Moment and the media representing it.
   *
   * @param tx - The caller's transaction. Both writes share it.
   * @param moment - Everything established when it was recorded.
   * @returns Nothing. The identifier is ours and duplicates are impossible, so
   *   this either writes or throws.
   */
  async insert(tx: Transaction, moment: NewMoment): Promise<void> {
    await tx.insert(MomentRow, {
      momentId: moment.momentId,
      authorUserId: moment.authorUserId,
      caption: moment.caption,
      occurrenceStart: new Date(moment.occurrence.start),
      occurrenceEnd: new Date(moment.occurrence.end),
      occurrencePrecision: moment.occurrence.precision,
      occurrenceOffsetMinutes: moment.occurrenceOffsetMinutes,
      visibility: "private",
      createdAt: moment.createdAt,
      updatedAt: moment.createdAt,
      deletedAt: null,
    });

    await tx.insert(
      MomentMedium,
      moment.media.map((medium) => ({
        momentId: moment.momentId,
        uploadId: medium.uploadId,
        position: medium.position,
        createdAt: moment.createdAt,
      })),
    );
  }

  /**
   * Read one Moment.
   *
   * @param momentId - Which Moment.
   * @returns The Moment with its media in order, or undefined when there is no
   *   such record or it has been deleted. Deleted reads as absent: a tombstone
   *   is not something a caller should be able to tell apart from nothing.
   */
  async findById(momentId: string): Promise<MomentContract | undefined> {
    const row = await this.dataSource.getRepository(MomentRow).findOne({
      where: { momentId, deletedAt: IsNull() },
      relations: { media: { upload: true } },
    });

    return row === null ? undefined : toMoment(row);
  }

  /**
   * Read a page of somebody's Moments, most recent occurrence first.
   *
   * @param authorUserId - Whose Moments.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page. Ordered by occurrence and then by identifier, which is
   *   what makes the order deterministic when two Moments share a time
   *   (`moments.md:284`) and what stops a Moment being skipped or repeated
   *   across a page boundary.
   */
  async findForAuthor(
    authorUserId: string,
    limit: number,
    cursor?: MomentCursor,
  ): Promise<MomentContract[]> {
    const query = this.dataSource
      .getRepository(MomentRow)
      .createQueryBuilder("moment")
      .leftJoinAndSelect("moment.media", "medium")
      .leftJoinAndSelect("medium.upload", "upload")
      .where("moment.author_user_id = :authorUserId", { authorUserId })
      .andWhere("moment.deleted_at IS NULL");

    if (cursor !== undefined) {
      // The pair compared as a tuple, so a Moment sharing an occurrence with
      // the last of the previous page is neither repeated nor skipped.
      query.andWhere(
        "(moment.occurrence_start, moment.moment_id) < (:occurrenceStart, :momentId)",
        { occurrenceStart: cursor.occurrenceStart, momentId: cursor.momentId },
      );
    }

    const rows = await query
      .orderBy("moment.occurrence_start", "DESC")
      .addOrderBy("moment.moment_id", "DESC")
      .take(limit)
      .getMany();

    return rows.map(toMoment);
  }
}
