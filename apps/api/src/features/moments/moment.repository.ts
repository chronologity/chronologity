import type { Cursor } from "../../lib/pagination/cursor.js";
import { randomUUID } from "node:crypto";
import type {
  CommentPolicy,
  LocationDisclosure,
  MomentVisibility,
  PublicUser,
  Occurrence,
  TemporalPrecision,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { IsNull } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { User } from "../users/user.model.js";
import { toPublicUser } from "../users/user.repository.js";
import type { Upload as UploadRow } from "../uploads/upload.model.js";
import { toUpload } from "../uploads/upload.repository.js";
import { toLocation } from "../locations/location.repository.js";
import { toRealWorldEvent } from "../real-world-events/real-world-event.repository.js";
import {
  Moment as MomentRow,
  MomentAudience,
  MomentEdit,
  MomentLocation,
  MomentMedium,
  MomentRealWorldEvent,
} from "./moment.model.js";
import type { MomentEditKind, NewMoment, UndisclosedMoment } from "./moment.types.js";

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
function toMoment(row: MomentRow): UndisclosedMoment {
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
    // Whole, and not yet reduced for anybody. Only `disclosePlace` decides how
    // much of it a given Viewer receives.
    location: row.place?.location === undefined ? undefined : toLocation(row.place.location),
    locationDisclosure: row.locationDisclosure as LocationDisclosure,
    // The larger occurrences it was part of, whole. Ordered by name so a caller
    // sees the same list twice running; the database has no opinion.
    realWorldEvents: (row.realWorldEvents ?? [])
      .map((association) => association.realWorldEvent)
      .filter((event): event is NonNullable<typeof event> => event !== undefined)
      .map(toRealWorldEvent)
      .sort((one, other) => one.name.localeCompare(other.name)),
    visibility: row.visibility as MomentVisibility,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The rule deciding whether a Viewer may see a Moment, as SQL.
 *
 * The same rule `checkVisibility` states in TypeScript. It exists twice because
 * a set query cannot call a per-row function without breaking keyset
 * pagination, and it exists here exactly once so that a third and fourth reader
 * do not each write their own — which is the mistake ADR-107 records about
 * cursors.
 *
 * Being the single statement of the rule is what made moderation tractable:
 * suspension, removal, temporary unavailability, audience narrowing, and the
 * age gate all landed in it, and every existing reader received them without
 * being changed.
 *
 * Reads `:viewerUserId` and `:viewerIsAdult`, which the caller must supply. The
 * second is resolved once per request rather than joined per row, and is
 * required rather than optional so that supplying it could not be forgotten:
 * the compiler names every caller.
 *
 * @param alias - The query-builder alias the Moment table is joined under.
 * @returns A SQL condition combining both halves.
 */
export function visibleToViewer(alias: string): string {
  return `(${privacyPermits(alias)} AND ${moderationPermits(alias)})`;
}

/**
 * The half of the rule that is about people.
 *
 * Blocking and the author's own audience choice. Ordered as the policy is: the
 * author first, then blocking, then visibility, so a Block cannot be outlived
 * by an invitation issued before it.
 *
 * Exported because the two halves have to be asked separately in one place.
 * A relationship read shows a tombstone where moderation took the far end, and
 * shows nothing at all where privacy did — `privacy.md:158` requires that
 * Chronologity "must never use a visible relationship to reveal an inaccessible
 * Moment", and a tombstone standing where a private Moment sits would announce
 * that somebody's private history exists and is connected to something. That a
 * platform removed something is Chronologity's own act to admit; that a person
 * kept something private is theirs.
 *
 * @param alias - The query-builder alias the Moment table is joined under.
 * @returns A SQL condition, true when no privacy rule withholds the Moment.
 */
export function privacyPermits(alias: string): string {
  return `(
    ${alias}.author_user_id = :viewerUserId
    OR (
      NOT EXISTS (
        SELECT 1 FROM user_blocks b
         WHERE (b.blocker_user_id = ${alias}.author_user_id AND b.blocked_user_id = :viewerUserId)
            OR (b.blocker_user_id = :viewerUserId AND b.blocked_user_id = ${alias}.author_user_id)
      )
      AND (
        ${alias}.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM moment_audience a
           WHERE a.moment_id = ${alias}.moment_id AND a.user_id = :viewerUserId
        )
      )
    )
  )`;
}

/**
 * The half of the rule that is about what Chronologity decided.
 *
 * The author is admitted first here as well, so neither a suspension nor a
 * moderator's decision hides somebody's own history from them. That is not a
 * courtesy: somebody who cannot see what was hidden cannot meaningfully appeal
 * it, and `moderation.md:680` expects the reason for an action to reach the
 * person it affected.
 *
 * `warned` and `restricted_from_amplification` are deliberately absent. Neither
 * hides anything from a direct reader, which is the line `moderation.md:211`
 * draws between existing, being reachable directly, and being promoted; the
 * second is enforced by the surfaces that amplify.
 *
 * @param alias - The query-builder alias the Moment table is joined under.
 * @returns A SQL condition, true when no moderation decision withholds the
 *   Moment from this Viewer.
 */
export function moderationPermits(alias: string): string {
  return `(
    ${alias}.author_user_id = :viewerUserId
    OR (
      NOT EXISTS (
        SELECT 1 FROM users author
         WHERE author.user_id = ${alias}.author_user_id
           AND author.status = 'suspended'
      )
      AND NOT EXISTS (
        SELECT 1 FROM moderation_states ms
         WHERE ms.subject_type = 'moment'
           AND ms.subject_id = ${alias}.moment_id
           AND (
             ms.state IN ('removed', 'temporarily_unavailable')
             OR (ms.state = 'age_restricted' AND NOT :viewerIsAdult)
             OR (
               ms.state = 'restricted_to_authorized_audience'
               AND NOT EXISTS (
                 SELECT 1 FROM moment_audience a
                  WHERE a.moment_id = ${alias}.moment_id AND a.user_id = :viewerUserId
               )
             )
           )
      )
    )
  )`;
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
      visibility: moment.visibility,
      locationDisclosure: moment.locationDisclosure,
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
  async findById(momentId: string): Promise<UndisclosedMoment | undefined> {
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
  ): Promise<UndisclosedMoment[]> {
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
   * Read a page of one person's Moments as somebody else may see them.
   *
   * The rule is applied in SQL rather than to the rows after they arrive.
   * Filtering afterwards would return short pages while the cursor claimed
   * there was more, and would step the cursor over Moments the Viewer was
   * entitled to see. It is the same rule `checkVisibility` states, in the only
   * form a set query can use, and a test holds the two in agreement.
   *
   * @param authorUserId - Whose Moments.
   * @param viewerUserId - Who is asking. Their own Moments are always included,
   *   whatever their visibility or moderation state, so this is safe to call
   *   for oneself.
   * @param viewerIsAdult - Whether the Viewer is old enough for age-restricted
   *   content. Resolved once by the caller rather than per row.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page, in the same deterministic order as everywhere else.
   */
  async findForAuthorAsViewer(
    authorUserId: string,
    viewerUserId: string,
    viewerIsAdult: boolean,
    limit: number,
    cursor?: Cursor,
  ): Promise<UndisclosedMoment[]> {
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
      .andWhere("moment.deleted_at IS NULL")
      .andWhere(visibleToViewer("moment"), { viewerUserId, viewerIsAdult });

    if (cursor !== undefined) {
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
   * Whether somebody is named on a Moment's list.
   *
   * @param momentId - Which Moment.
   * @param userId - Who is asking.
   * @returns Whether they are on it. Says nothing about whether the Moment is
   *   restricted: a list may outlive the visibility that consulted it, and only
   *   the policy decides whether it matters.
   */
  async isInAudience(momentId: string, userId: string): Promise<boolean> {
    return this.dataSource
      .getRepository(MomentAudience)
      .existsBy({ momentId, userId });
  }

  /**
   * Read who may see a restricted Moment.
   *
   * @param momentId - Which Moment.
   * @returns The people named, in the order they were added, each whole rather
   *   than by identifier: a list of opaque identifiers would need a second call
   *   to be of any use to whoever is looking at their own audience.
   */
  async findAudience(momentId: string): Promise<PublicUser[]> {
    const rows = await this.dataSource
      .getRepository(MomentAudience)
      .createQueryBuilder("member")
      .innerJoinAndMapOne("member.user", User, "user", "user.user_id = member.user_id")
      .where("member.moment_id = :momentId", { momentId })
      .orderBy("member.added_at", "ASC")
      .addOrderBy("member.user_id", "ASC")
      .getMany();

    return rows
      .map((row) => row.user)
      .filter((user): user is NonNullable<typeof user> => user !== undefined)
      .map(toPublicUser);
  }

  /**
   * Set who may see a Moment, and who is named on it, together.
   *
   * One statement each, in the caller's transaction, so a Moment is never
   * briefly restricted with a list from an earlier decision.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param visibility - Who may see it.
   * @param audience - Who is named, replacing whoever was named before. An
   *   empty list clears it, which is what changing away from `restricted`
   *   should do: leaving names behind would let a later change to `restricted`
   *   silently readmit people nobody had reconsidered.
   * @param at - When.
   * @returns Nothing.
   */
  async setVisibility(
    tx: Transaction,
    momentId: string,
    visibility: MomentVisibility,
    audience: readonly string[],
    at: Date,
  ): Promise<void> {
    await tx.update(MomentRow, { momentId }, { visibility, updatedAt: at });

    await tx.delete(MomentAudience, { momentId });

    if (audience.length > 0) {
      await tx.insert(
        MomentAudience,
        audience.map((userId) => ({ momentId, userId, addedAt: at })),
      );
    }
  }

  /**
   * Who may join a Moment's discussion.
   *
   * @param momentId - Which Moment.
   * @returns Its policy. A Moment that does not exist admits nobody, which the
   *   caller has already refused on other grounds by the time this is asked.
   */
  async commentPolicy(momentId: string): Promise<CommentPolicy> {
    const row = await this.dataSource
      .getRepository(MomentRow)
      .findOne({ where: { momentId }, select: { commentPolicy: true } });

    return (row?.commentPolicy as CommentPolicy) ?? "disabled";
  }

  /**
   * Set who may join a Moment's discussion.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param policy - Who may join.
   * @param at - When.
   * @returns Nothing. Nothing said already is touched: closing a discussion
   *   leaves it readable (`comments.md:427`).
   */
  async setCommentPolicy(
    tx: Transaction,
    momentId: string,
    policy: CommentPolicy,
    at: Date,
  ): Promise<void> {
    await tx.update(MomentRow, { momentId }, { commentPolicy: policy, updatedAt: at });
  }

  /**
   * Whether a Moment is accepting reactions.
   *
   * @param momentId - Which Moment.
   * @returns Whether it accepts them. A Moment that does not exist accepts
   *   nothing, which the caller has already refused on other grounds by the
   *   time this is asked.
   */
  async acceptsReactions(momentId: string): Promise<boolean> {
    const row = await this.dataSource
      .getRepository(MomentRow)
      .findOne({ where: { momentId }, select: { reactionsEnabled: true } });

    return row?.reactionsEnabled ?? false;
  }

  /**
   * Set how much of a Moment's place other people are told.
   *
   * Independent of which place it is. Somebody who moves a Moment to a
   * different venue has not thereby decided to publish it, so this is its own
   * column and its own operation.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param disclosure - How much to tell everybody but the author.
   * @param at - When.
   * @returns Nothing.
   */
  async setLocationDisclosure(
    tx: Transaction,
    momentId: string,
    disclosure: LocationDisclosure,
    at: Date,
  ): Promise<void> {
    await tx.update(MomentRow, { momentId }, { locationDisclosure: disclosure, updatedAt: at });
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
