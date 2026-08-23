import type { Cursor } from "../../lib/pagination/cursor.js";
import { randomUUID } from "node:crypto";
import type {
  Moment as MomentContract,
  Occurrence,
  TemporalPrecision,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { IsNull } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import type { Upload as UploadRow } from "../uploads/upload.model.js";
import { toUpload } from "../uploads/upload.repository.js";
import { toLocation } from "../locations/location.repository.js";
import { toRealWorldEvent } from "../real-world-events/real-world-event.repository.js";
import {
  Moment as MomentRow,
  MomentEdit,
  MomentLocation,
  MomentMedium,
  MomentRealWorldEvent,
} from "./moment.model.js";
import type { MomentEditKind, NewMoment } from "./moment.types.js";

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
    // Where it happened, whole. Null rather than absent when nobody said: a
    // missing key would mean "not loaded", and this means "not known".
    location: row.place?.location === undefined ? null : toLocation(row.place.location),
    // The larger occurrences it was part of, whole. Ordered by name so a caller
    // sees the same list twice running; the database has no opinion.
    realWorldEvents: (row.realWorldEvents ?? [])
      .map((association) => association.realWorldEvent)
      .filter((event): event is NonNullable<typeof event> => event !== undefined)
      .map(toRealWorldEvent)
      .sort((one, other) => one.name.localeCompare(other.name)),
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
      relations: {
        media: { upload: true },
        place: { location: true },
        realWorldEvents: { realWorldEvent: { aliases: true, locations: true } },
      },
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
    cursor?: Cursor,
  ): Promise<MomentContract[]> {
    const query = this.dataSource
      .getRepository(MomentRow)
      .createQueryBuilder("moment")
      .leftJoinAndSelect("moment.media", "medium")
      .leftJoinAndSelect("medium.upload", "upload")
      .leftJoinAndSelect("moment.place", "place")
      .leftJoinAndSelect("place.location", "location")
      .leftJoinAndSelect("moment.realWorldEvents", "association")
      .leftJoinAndSelect("association.realWorldEvent", "event")
      .leftJoinAndSelect("event.aliases", "alias")
      .leftJoinAndSelect("event.locations", "eventPlace")
      .where("moment.author_user_id = :authorUserId", { authorUserId })
      .andWhere("moment.deleted_at IS NULL");

    if (cursor !== undefined) {
      // The pair compared as a tuple, so a Moment sharing an occurrence with
      // the last of the previous page is neither repeated nor skipped.
      query.andWhere(
        "(moment.occurrence_start, moment.moment_id) < (:occurrenceStart, :momentId)",
        { occurrenceStart: cursor.at, momentId: cursor.id },
      );
    }

    const rows = await query
      .orderBy("moment.occurrence_start", "DESC")
      .addOrderBy("moment.moment_id", "DESC")
      .take(limit)
      .getMany();

    return rows.map(toMoment);
  }

  /**
   * Say where a Moment happened, replacing whatever was said before.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param locationId - Which place.
   * @param at - When the association was made.
   * @returns Nothing. Written as an upsert because a Moment has one place and
   *   saying where it happened twice is a correction rather than a second
   *   claim.
   */
  async setLocation(
    tx: Transaction,
    momentId: string,
    locationId: string,
    at: Date,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(MomentLocation)
      .values({ momentId, locationId, origin: "user-asserted", createdAt: at })
      .orUpdate(["location_id", "origin", "created_at"], ["moment_id"])
      .execute();
  }

  /**
   * Take back where a Moment happened.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @returns True if there was a place to remove. False means there was none,
   *   which a caller asking to remove one can treat as already done.
   */
  async clearLocation(tx: Transaction, momentId: string): Promise<boolean> {
    const { affected } = await tx.delete(MomentLocation, { momentId });

    return affected === 1;
  }

  /**
   * Say a Moment was part of an occurrence.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param realWorldEventId - Which occurrence.
   * @param at - When the association was made.
   * @returns Nothing. Saying it twice is the same claim made twice, which is
   *   one association — so a repeat is ignored rather than refused.
   */
  async addRealWorldEvent(
    tx: Transaction,
    momentId: string,
    realWorldEventId: string,
    at: Date,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(MomentRealWorldEvent)
      .values({ momentId, realWorldEventId, origin: "user-asserted", createdAt: at })
      .orIgnore()
      .execute();
  }

  /**
   * Take back a Moment's association with an occurrence.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param realWorldEventId - Which occurrence.
   * @returns True if there was an association to remove.
   */
  async removeRealWorldEvent(
    tx: Transaction,
    momentId: string,
    realWorldEventId: string,
  ): Promise<boolean> {
    const { affected } = await tx.delete(MomentRealWorldEvent, { momentId, realWorldEventId });

    return affected === 1;
  }

  /**
   * Read the media a Moment currently has, in order.
   *
   * @param momentId - Which Moment.
   * @returns The identifiers, ordered by position. What the editing rules are
   *   checked against, so it reads the association rather than the Moment's
   *   whole shape.
   */
  async findMediaOrder(momentId: string): Promise<string[]> {
    const rows = await this.dataSource.getRepository(MomentMedium).find({
      where: { momentId },
      select: { uploadId: true, position: true },
      order: { position: "ASC" },
    });

    return rows.map((row) => row.uploadId);
  }

  /**
   * Record what somebody changed about a Moment, and what it was before.
   *
   * @param tx - The caller's transaction. The change and this record share it:
   *   an edit with no record of it, and a record of an edit that did not
   *   happen, are both worse than the edit failing.
   * @param edit - Which Moment, who changed it, what kind of change, and the
   *   previous state of whatever changed.
   * @returns Nothing.
   */
  async recordEdit(
    tx: Transaction,
    edit: {
      momentId: string;
      editedByUserId: string;
      kind: MomentEditKind;
      previous: object;
      at: Date;
    },
  ): Promise<void> {
    await tx.insert(MomentEdit, {
      editId: randomUUID(),
      momentId: edit.momentId,
      editedByUserId: edit.editedByUserId,
      kind: edit.kind,
      previous: edit.previous,
      editedAt: edit.at,
    });
  }

  /**
   * Change what a Moment says happened.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param caption - The corrected words.
   * @param at - When.
   * @returns Nothing. Deliberately touches nothing temporal: `moments.md:313`
   *   requires that editing descriptive text not move a Moment through
   *   chronological navigation.
   */
  async updateCaption(
    tx: Transaction,
    momentId: string,
    caption: string,
    at: Date,
  ): Promise<void> {
    await tx.update(MomentRow, { momentId }, { caption, updatedAt: at });
  }

  /**
   * Move a Moment to where it actually belongs in history.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param occurrence - The corrected interval and precision.
   * @param offsetMinutes - The corrected offset from UTC.
   * @param at - When the correction was made.
   * @returns Nothing. This changes the Moment's position in chronology, which
   *   is why it is a correction rather than an edit (`moments.md:443`).
   */
  async updateOccurrence(
    tx: Transaction,
    momentId: string,
    occurrence: Occurrence,
    offsetMinutes: number,
    at: Date,
  ): Promise<void> {
    await tx.update(
      MomentRow,
      { momentId },
      {
        occurrenceStart: new Date(occurrence.start),
        occurrenceEnd: new Date(occurrence.end),
        occurrencePrecision: occurrence.precision,
        occurrenceOffsetMinutes: offsetMinutes,
        updatedAt: at,
      },
    );
  }

  /**
   * Replace the media a Moment shows, and the order it shows them in.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param uploadIds - The media, in the order it should be shown.
   * @param at - When.
   * @returns Nothing. Written as a delete and an insert rather than as a
   *   difference, because positions are dense and unique per Moment: shuffling
   *   two rows in place would collide with the index before the second could
   *   land.
   */
  async replaceMedia(
    tx: Transaction,
    momentId: string,
    uploadIds: readonly string[],
    at: Date,
  ): Promise<void> {
    await tx.delete(MomentMedium, { momentId });

    await tx.insert(
      MomentMedium,
      uploadIds.map((uploadId, position) => ({ momentId, uploadId, position, createdAt: at })),
    );

    await tx.update(MomentRow, { momentId }, { updatedAt: at });
  }

  /**
   * Take a Moment out of ordinary access.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param at - When.
   * @returns True if this call removed it. False means it was already gone,
   *   decided by the statement rather than by a read before it.
   */
  async markDeleted(tx: Transaction, momentId: string, at: Date): Promise<boolean> {
    const { affected } = await tx.update(
      MomentRow,
      { momentId, deletedAt: IsNull() },
      { deletedAt: at, updatedAt: at },
    );

    return affected === 1;
  }
}
