import type { DataSource } from "typeorm";
import type { Cursor } from "../../lib/pagination/cursor.js";
import type { Transaction } from "../../lib/database/transaction.js";
import {
  AccuracyReportRow,
  ModerationAction,
  ModerationAppeal,
  ModerationReportRow,
  ModerationStateRow,
} from "./moderation.model.js";

/** What a subject is and who it belongs to. */
export interface SubjectOwner {
  /** Whose it is. */
  readonly ownerUserId: string;
  /**
   * The Moment a medium belongs to, where the subject is one.
   *
   * Carried because moderating a medium can reach the Moment holding it: a
   * Moment whose last medium is moderated cannot remain readable, media being
   * what a Moment could not have been created without.
   */
  readonly momentId?: string;
}

/** Everything needed to write one decision down. */
export interface NewAction {
  readonly actionId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly state: string | null;
  readonly affectedUserId: string | null;
  readonly actorUserId: string | null;
  readonly actorKind: string;
  readonly outcome: string;
  readonly reason: string;
  readonly occurredAt: Date;
}

/**
 * Reads and writes moderation records.
 *
 * The states table is deliberately sparse: absent means `allowed`, so nothing
 * writes a row to say that the overwhelming majority of everything is fine.
 * Every read here treats a missing row as permission, which is safe precisely
 * because the write path never deletes a row to mean "restricted".
 */
export class ModerationRepository {
  /**
   * Build the moderation repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction of their own.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * What Chronologity is currently doing about one thing.
   *
   * @param subjectType - What kind of thing.
   * @param subjectId - Which one.
   * @returns Its state, or undefined when nothing has been decided about it —
   *   which is the ordinary case and means `allowed`.
   */
  async findState(subjectType: string, subjectId: string): Promise<ModerationStateRow | undefined> {
    return (
      (await this.dataSource
        .getRepository(ModerationStateRow)
        .findOne({ where: { subjectType, subjectId } })) ?? undefined
    );
  }

  /**
   * Put something into a state, replacing whatever it was in.
   *
   * @param tx - The caller's transaction, shared with the action that records
   *   the decision, so a state can never exist with no audit trail behind it.
   * @param row - The subject, the state, why, and who decided.
   * @returns Nothing.
   */
  async setState(
    tx: Transaction,
    row: {
      subjectType: string;
      subjectId: string;
      state: string;
      reason: string;
      decidedByUserId: string | null;
      decidedAt: Date;
    },
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(ModerationStateRow)
      .values(row)
      .orUpdate(["state", "reason", "decided_by_user_id", "decided_at"], [
        "subject_type",
        "subject_id",
      ])
      .execute();
  }

  /**
   * Stop moderating something.
   *
   * Deletes the row rather than writing `allowed`, keeping the table sparse and
   * keeping one meaning for absence. What was decided survives in the actions
   * table, which is the record that must not be erasable.
   *
   * @param tx - The caller's transaction.
   * @param subjectType - What kind of thing.
   * @param subjectId - Which one.
   * @returns Nothing.
   */
  async clearState(tx: Transaction, subjectType: string, subjectId: string): Promise<void> {
    await tx.delete(ModerationStateRow, { subjectType, subjectId });
  }

  /**
   * Write one decision, or one refusal, into the permanent record.
   *
   * @param tx - The caller's transaction.
   * @param action - What was done or attempted, by whom, and why.
   * @returns Nothing. Identifiers are ours, so this either writes or throws.
   */
  async recordAction(tx: Transaction, action: NewAction): Promise<void> {
    await tx.insert(ModerationAction, action);
  }

  /**
   * One recorded decision.
   *
   * @param actionId - Which one.
   * @returns The action, or undefined if there is no such record.
   */
  async findAction(actionId: string): Promise<ModerationAction | undefined> {
    return (
      (await this.dataSource.getRepository(ModerationAction).findOne({ where: { actionId } })) ??
      undefined
    );
  }

  /**
   * What was done to one person's content, newest first.
   *
   * @param affectedUserId - Whose content.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page. Refusals are excluded: a refused attempt is evidence for
   *   a security review rather than something to tell the person it was aimed
   *   at, and reporting it would announce that somebody tried.
   */
  async listActionsAffecting(
    affectedUserId: string,
    limit: number,
    cursor?: Cursor,
  ): Promise<ModerationAction[]> {
    const query = this.dataSource
      .getRepository(ModerationAction)
      .createQueryBuilder("action")
      .where("action.affected_user_id = :affectedUserId", { affectedUserId })
      .andWhere("action.outcome = 'success'");

    if (cursor !== undefined) {
      query.andWhere(
        "(action.occurred_at, action.action_id) < (:cursorAt, :cursorId)",
        { cursorAt: cursor.at, cursorId: cursor.id },
      );
    }

    return query
      .orderBy("action.occurred_at", "DESC")
      .addOrderBy("action.action_id", "DESC")
      .take(limit)
      .getMany();
  }

  /**
   * Which of these actions have been appealed, and how those appeals went.
   *
   * Batched rather than asked per row, so a page of history costs two queries
   * instead of one per record.
   *
   * @param actionIds - The actions on the page.
   * @returns The appeals against them, keyed by action.
   */
  async findAppealsForActions(actionIds: readonly string[]): Promise<Map<string, ModerationAppeal>> {
    if (actionIds.length === 0) {
      return new Map();
    }

    const appeals = await this.dataSource
      .getRepository(ModerationAppeal)
      .createQueryBuilder("appeal")
      .where("appeal.action_id IN (:...actionIds)", { actionIds: [...actionIds] })
      .getMany();

    return new Map(appeals.map((appeal) => [appeal.actionId, appeal]));
  }

  /**
   * Who a subject belongs to.
   *
   * @param subjectType - What kind of thing.
   * @param subjectId - Which one.
   * @returns Its owner, and for a medium the Moment holding it. Undefined when
   *   there is no such subject, which is how reporting something that does not
   *   exist is refused.
   */
  async findSubjectOwner(
    subjectType: string,
    subjectId: string,
  ): Promise<SubjectOwner | undefined> {
    switch (subjectType) {
      case "moment": {
        const rows: { author_user_id: string }[] = await this.dataSource.query(
          "SELECT author_user_id FROM moments WHERE moment_id = $1 AND deleted_at IS NULL",
          [subjectId],
        );

        return rows[0] === undefined ? undefined : { ownerUserId: rows[0].author_user_id };
      }
      case "comment": {
        const rows: { author_user_id: string }[] = await this.dataSource.query(
          "SELECT author_user_id FROM moment_comments WHERE comment_id = $1 AND deleted_at IS NULL",
          [subjectId],
        );

        return rows[0] === undefined ? undefined : { ownerUserId: rows[0].author_user_id };
      }
      case "user": {
        const rows: { user_id: string }[] = await this.dataSource.query(
          "SELECT user_id FROM users WHERE user_id = $1",
          [subjectId],
        );

        return rows[0] === undefined ? undefined : { ownerUserId: rows[0].user_id };
      }
      case "media": {
        // The Moment comes back with the owner because moderating a medium can
        // reach the Moment holding it, and asking twice would let the two
        // answers come from different instants.
        const rows: { owner_user_id: string; moment_id: string | null }[] =
          await this.dataSource.query(
            `SELECT u.owner_user_id, mm.moment_id
               FROM uploads u
               LEFT JOIN moment_media mm ON mm.upload_id = u.upload_id
              WHERE u.upload_id = $1`,
            [subjectId],
          );

        const row = rows[0];

        if (row === undefined) {
          return undefined;
        }

        return {
          ownerUserId: row.owner_user_id,
          ...(row.moment_id === null ? {} : { momentId: row.moment_id }),
        };
      }
      default:
        return undefined;
    }
  }

  /**
   * How many media a Moment would still have if one were moderated away.
   *
   * @param momentId - Which Moment.
   * @param excludingUploadId - The medium being moderated.
   * @returns How many of its media remain readable. Media already moderated are
   *   not counted, so moderating the second-to-last and then the last does not
   *   leave a Moment that appears to still have one.
   */
  async countRemainingMedia(momentId: string, excludingUploadId: string): Promise<number> {
    const rows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(*)::text AS count
         FROM moment_media mm
        WHERE mm.moment_id = $1
          AND mm.upload_id <> $2
          AND NOT EXISTS (
                SELECT 1 FROM moderation_states ms
                 WHERE ms.subject_type = 'media'
                   AND ms.subject_id = mm.upload_id
                   AND ms.state IN ('removed', 'temporarily_unavailable')
              )`,
      [momentId, excludingUploadId],
    );

    return Number(rows[0]?.count ?? "0");
  }

  /**
   * File a safety report.
   *
   * @param tx - The caller's transaction.
   * @param report - What is being reported, by whom, and why.
   * @returns Whether a row was written. False means this person has already
   *   reported this subject, which the unique constraint refuses; the caller
   *   returns them the report they already filed rather than an error, since
   *   "you already told us" is not a failure on their part.
   */
  async insertReport(
    tx: Transaction,
    report: {
      reportId: string;
      subjectType: string;
      subjectId: string;
      reporterUserId: string;
      reason: string;
      detail: string | null;
      status: string;
      priority: string;
      createdAt: Date;
    },
  ): Promise<boolean> {
    const inserted = await tx
      .createQueryBuilder()
      .insert()
      .into(ModerationReportRow)
      .values(report)
      .orIgnore()
      // Explicit, and checked by length: `orIgnore` populates `identifiers`
      // whether or not a row was written, so the returned rows are the only
      // honest signal (ADR-102). The name here is the entity's property, not
      // the column: a column name is silently not recognised, and the result
      // then reports every insert as a duplicate.
      .returning(["reportId"])
      .execute();

    return (inserted.raw as unknown[]).length > 0;
  }

  /**
   * One person's report about one subject.
   *
   * @param subjectType - What kind of thing.
   * @param subjectId - Which one.
   * @param reporterUserId - Who reported it.
   * @returns Their report, or undefined if they have not reported it.
   */
  async findReportBy(
    subjectType: string,
    subjectId: string,
    reporterUserId: string,
  ): Promise<ModerationReportRow | undefined> {
    return (
      (await this.dataSource
        .getRepository(ModerationReportRow)
        .findOne({ where: { subjectType, subjectId, reporterUserId } })) ?? undefined
    );
  }

  /**
   * One report.
   *
   * @param reportId - Which one.
   * @returns The report, or undefined if there is no such report.
   */
  async findReport(reportId: string): Promise<ModerationReportRow | undefined> {
    return (
      (await this.dataSource
        .getRepository(ModerationReportRow)
        .findOne({ where: { reportId } })) ?? undefined
    );
  }

  /**
   * When every report about one subject arrived.
   *
   * @param subjectType - What kind of thing.
   * @param subjectId - Which one.
   * @returns Their arrival times, oldest first. Read for the count and for the
   *   burst flag together, so the two cannot describe different sets.
   */
  async reportTimesFor(subjectType: string, subjectId: string): Promise<Date[]> {
    const rows: { created_at: Date }[] = await this.dataSource.query(
      `SELECT created_at FROM moderation_reports
        WHERE subject_type = $1 AND subject_id = $2
        ORDER BY created_at`,
      [subjectType, subjectId],
    );

    return rows.map((row) => row.created_at);
  }

  /**
   * Set the review priority of every open report about one subject.
   *
   * Applied to all of them rather than to the newest, so a queue ordered by
   * priority does not show one subject at two urgencies.
   *
   * @param tx - The caller's transaction.
   * @param subjectType - What kind of thing.
   * @param subjectId - Which one.
   * @param priority - Where it now sits in the queue.
   * @returns Nothing.
   */
  async setPriorityFor(
    tx: Transaction,
    subjectType: string,
    subjectId: string,
    priority: string,
  ): Promise<void> {
    await tx.query(
      `UPDATE moderation_reports SET priority = $3
        WHERE subject_type = $1 AND subject_id = $2
          AND status IN ('submitted', 'under_review')`,
      [subjectType, subjectId, priority],
    );
  }

  /**
   * Move one report to a new status.
   *
   * Conditional on the status it was read at, rather than read-then-write: two
   * moderators closing the same report at once must not both succeed, and the
   * loser must be told rather than silently overwritten.
   *
   * @param tx - The caller's transaction.
   * @param reportId - Which report.
   * @param from - The status it held when the decision was made.
   * @param to - Where it is going.
   * @param at - When, recorded as the resolution time for a terminal status.
   * @returns Whether the move happened. False means somebody else moved it
   *   first.
   */
  async transitionReport(
    tx: Transaction,
    reportId: string,
    from: string,
    to: string,
    at: Date,
  ): Promise<boolean> {
    // Counted in SQL rather than from the driver's result shape. A bare DML
    // through `query` comes back as `[rows, affected]`, and reading `.length`
    // off that reports two every time — a mistake this codebase has made once
    // already, in the outbox sweep.
    const rows: { count: number }[] = await tx.query(
      `WITH moved AS (
          UPDATE moderation_reports
             SET status = $3,
                 resolved_at = CASE WHEN $3 IN ('resolved', 'closed') THEN $4 ELSE resolved_at END
           WHERE report_id = $1 AND status = $2
       RETURNING 1
       ) SELECT COUNT(*)::int AS count FROM moved`,
      [reportId, from, to, at],
    );

    return (rows[0]?.count ?? 0) > 0;
  }

  /**
   * Resolve every open report about one subject.
   *
   * What stops the queue filling with work already done, and what stops a
   * reporter watching a report that was acted on days ago.
   *
   * @param tx - The caller's transaction.
   * @param subjectType - What kind of thing.
   * @param subjectId - Which one.
   * @param at - When.
   * @returns How many were resolved.
   */
  async resolveOpenReportsFor(
    tx: Transaction,
    subjectType: string,
    subjectId: string,
    at: Date,
  ): Promise<number> {
    const rows: { count: number }[] = await tx.query(
      `WITH resolved AS (
          UPDATE moderation_reports
             SET status = 'resolved', resolved_at = $3
           WHERE subject_type = $1 AND subject_id = $2
             AND status IN ('submitted', 'under_review')
       RETURNING 1
       ) SELECT COUNT(*)::int AS count FROM resolved`,
      [subjectType, subjectId, at],
    );

    return rows[0]?.count ?? 0;
  }

  /**
   * The reports one person filed, newest first.
   *
   * @param reporterUserId - Who filed them.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page.
   */
  async listReportsBy(
    reporterUserId: string,
    limit: number,
    cursor?: Cursor,
  ): Promise<ModerationReportRow[]> {
    const query = this.dataSource
      .getRepository(ModerationReportRow)
      .createQueryBuilder("report")
      .where("report.reporter_user_id = :reporterUserId", { reporterUserId });

    if (cursor !== undefined) {
      query.andWhere("(report.created_at, report.report_id) < (:cursorAt, :cursorId)", {
        cursorAt: cursor.at,
        cursorId: cursor.id,
      });
    }

    return query
      .orderBy("report.created_at", "DESC")
      .addOrderBy("report.report_id", "DESC")
      .take(limit)
      .getMany();
  }

  /**
   * The safety queue: what is still open, oldest first within a priority.
   *
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page, ascending by arrival, so the oldest unattended report is
   *   first and nothing waits indefinitely behind a stream of newer ones.
   */
  async listOpenReports(limit: number, cursor?: Cursor): Promise<ModerationReportRow[]> {
    const query = this.dataSource
      .getRepository(ModerationReportRow)
      .createQueryBuilder("report")
      .where("report.status IN ('submitted', 'under_review')");

    if (cursor !== undefined) {
      query.andWhere("(report.created_at, report.report_id) > (:cursorAt, :cursorId)", {
        cursorAt: cursor.at,
        cursorId: cursor.id,
      });
    }

    return query
      .orderBy("report.created_at", "ASC")
      .addOrderBy("report.report_id", "ASC")
      .take(limit)
      .getMany();
  }

  /**
   * File a historical-accuracy report.
   *
   * @param tx - The caller's transaction.
   * @param report - Which Moment, by whom, and what they say is wrong.
   * @returns Whether a row was written. False means they have already reported
   *   this Moment.
   */
  async insertAccuracyReport(
    tx: Transaction,
    report: {
      reportId: string;
      momentId: string;
      reporterUserId: string;
      reason: string;
      detail: string;
      status: string;
      createdAt: Date;
    },
  ): Promise<boolean> {
    const inserted = await tx
      .createQueryBuilder()
      .insert()
      .into(AccuracyReportRow)
      .values(report)
      .orIgnore()
      .returning(["reportId"])
      .execute();

    return (inserted.raw as unknown[]).length > 0;
  }

  /**
   * One person's accuracy report about one Moment.
   *
   * @param momentId - Which Moment.
   * @param reporterUserId - Who reported it.
   * @returns Their report, or undefined if they have not reported it.
   */
  async findAccuracyReportBy(
    momentId: string,
    reporterUserId: string,
  ): Promise<AccuracyReportRow | undefined> {
    return (
      (await this.dataSource
        .getRepository(AccuracyReportRow)
        .findOne({ where: { momentId, reporterUserId } })) ?? undefined
    );
  }

  /**
   * One accuracy report.
   *
   * @param reportId - Which one.
   * @returns The report, or undefined if there is no such report.
   */
  async findAccuracyReport(reportId: string): Promise<AccuracyReportRow | undefined> {
    return (
      (await this.dataSource.getRepository(AccuracyReportRow).findOne({ where: { reportId } })) ??
      undefined
    );
  }

  /**
   * The accuracy reports one person filed, newest first.
   *
   * @param reporterUserId - Who filed them.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page.
   */
  async listAccuracyReportsBy(
    reporterUserId: string,
    limit: number,
    cursor?: Cursor,
  ): Promise<AccuracyReportRow[]> {
    const query = this.dataSource
      .getRepository(AccuracyReportRow)
      .createQueryBuilder("report")
      .where("report.reporter_user_id = :reporterUserId", { reporterUserId });

    if (cursor !== undefined) {
      query.andWhere("(report.created_at, report.report_id) < (:cursorAt, :cursorId)", {
        cursorAt: cursor.at,
        cursorId: cursor.id,
      });
    }

    return query
      .orderBy("report.created_at", "DESC")
      .addOrderBy("report.report_id", "DESC")
      .take(limit)
      .getMany();
  }

  /**
   * The accuracy queue, oldest first.
   *
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page. Holds no safety reports: they are a different table, so
   *   the separation is structural rather than a filter somebody could forget.
   */
  async listOpenAccuracyReports(limit: number, cursor?: Cursor): Promise<AccuracyReportRow[]> {
    const query = this.dataSource
      .getRepository(AccuracyReportRow)
      .createQueryBuilder("report")
      .where("report.status IN ('submitted', 'under_review')");

    if (cursor !== undefined) {
      query.andWhere("(report.created_at, report.report_id) > (:cursorAt, :cursorId)", {
        cursorAt: cursor.at,
        cursorId: cursor.id,
      });
    }

    return query
      .orderBy("report.created_at", "ASC")
      .addOrderBy("report.report_id", "ASC")
      .take(limit)
      .getMany();
  }

  /**
   * Move one accuracy report to a new status.
   *
   * @param tx - The caller's transaction.
   * @param reportId - Which report.
   * @param from - The status it held when the decision was made.
   * @param to - Where it is going.
   * @param at - When.
   * @returns Whether the move happened. False means somebody else moved it
   *   first.
   */
  async transitionAccuracyReport(
    tx: Transaction,
    reportId: string,
    from: string,
    to: string,
    at: Date,
  ): Promise<boolean> {
    const rows: { count: number }[] = await tx.query(
      `WITH moved AS (
          UPDATE accuracy_reports
             SET status = $3,
                 resolved_at = CASE WHEN $3 IN ('resolved', 'closed') THEN $4 ELSE resolved_at END
           WHERE report_id = $1 AND status = $2
       RETURNING 1
       ) SELECT COUNT(*)::int AS count FROM moved`,
      [reportId, from, to, at],
    );

    return (rows[0]?.count ?? 0) > 0;
  }

  /**
   * File an appeal.
   *
   * @param tx - The caller's transaction.
   * @param appeal - Which action, by whom, and what they say about it.
   * @returns Whether a row was written. False means an appeal against this
   *   action is already open, which the partial unique index refuses.
   */
  async insertAppeal(
    tx: Transaction,
    appeal: {
      appealId: string;
      actionId: string;
      appellantUserId: string;
      statement: string;
      status: string;
      createdAt: Date;
    },
  ): Promise<boolean> {
    const inserted = await tx
      .createQueryBuilder()
      .insert()
      .into(ModerationAppeal)
      .values(appeal)
      .orIgnore()
      .returning(["appealId"])
      .execute();

    return (inserted.raw as unknown[]).length > 0;
  }

  /**
   * One appeal.
   *
   * @param appealId - Which one.
   * @returns The appeal, or undefined if there is no such appeal.
   */
  async findAppeal(appealId: string): Promise<ModerationAppeal | undefined> {
    return (
      (await this.dataSource.getRepository(ModerationAppeal).findOne({ where: { appealId } })) ??
      undefined
    );
  }

  /**
   * The appeals one person filed, newest first.
   *
   * @param appellantUserId - Who filed them.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page.
   */
  async listAppealsBy(
    appellantUserId: string,
    limit: number,
    cursor?: Cursor,
  ): Promise<ModerationAppeal[]> {
    const query = this.dataSource
      .getRepository(ModerationAppeal)
      .createQueryBuilder("appeal")
      .where("appeal.appellant_user_id = :appellantUserId", { appellantUserId });

    if (cursor !== undefined) {
      query.andWhere("(appeal.created_at, appeal.appeal_id) < (:cursorAt, :cursorId)", {
        cursorAt: cursor.at,
        cursorId: cursor.id,
      });
    }

    return query
      .orderBy("appeal.created_at", "DESC")
      .addOrderBy("appeal.appeal_id", "DESC")
      .take(limit)
      .getMany();
  }

  /**
   * The appeal queue, oldest first.
   *
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page.
   */
  async listOpenAppeals(limit: number, cursor?: Cursor): Promise<ModerationAppeal[]> {
    const query = this.dataSource
      .getRepository(ModerationAppeal)
      .createQueryBuilder("appeal")
      .where("appeal.status = 'open'");

    if (cursor !== undefined) {
      query.andWhere("(appeal.created_at, appeal.appeal_id) > (:cursorAt, :cursorId)", {
        cursorAt: cursor.at,
        cursorId: cursor.id,
      });
    }

    return query
      .orderBy("appeal.created_at", "ASC")
      .addOrderBy("appeal.appeal_id", "ASC")
      .take(limit)
      .getMany();
  }

  /**
   * Decide an appeal.
   *
   * Conditional on it still being open, so two moderators deciding at once
   * cannot both write an outcome.
   *
   * @param tx - The caller's transaction.
   * @param appealId - Which appeal.
   * @param outcome - How it was decided.
   * @param resolution - The moderator's explanation.
   * @param decidedByUserId - Who decided.
   * @param at - When.
   * @returns Whether the decision was recorded. False means it was already
   *   decided.
   */
  async decideAppeal(
    tx: Transaction,
    appealId: string,
    outcome: string,
    resolution: string,
    decidedByUserId: string,
    at: Date,
  ): Promise<boolean> {
    const rows: { count: number }[] = await tx.query(
      `WITH decided AS (
          UPDATE moderation_appeals
             SET status = 'decided', outcome = $2, resolution = $3,
                 decided_by_user_id = $4, decided_at = $5
           WHERE appeal_id = $1 AND status = 'open'
       RETURNING 1
       ) SELECT COUNT(*)::int AS count FROM decided`,
      [appealId, outcome, resolution, decidedByUserId, at],
    );

    return (rows[0]?.count ?? 0) > 0;
  }

  /**
   * Suspend an account or let it back.
   *
   * Conditional on the status it is moving from, so suspending an already
   * suspended account writes nothing and the caller can tell that it did.
   *
   * @param tx - The caller's transaction.
   * @param userId - Whose account.
   * @param from - The status it is expected to hold.
   * @param to - The status it should hold.
   * @returns Whether the change happened.
   */
  async transitionUserStatus(
    tx: Transaction,
    userId: string,
    from: string,
    to: string,
  ): Promise<boolean> {
    const rows: { count: number }[] = await tx.query(
      `WITH moved AS (
          UPDATE users SET status = $3, updated_at = now()
           WHERE user_id = $1 AND status = $2
       RETURNING 1
       ) SELECT COUNT(*)::int AS count FROM moved`,
      [userId, from, to],
    );

    return (rows[0]?.count ?? 0) > 0;
  }

  /**
   * An account's status.
   *
   * @param userId - Whose account.
   * @returns Its status, or undefined when there is no such account.
   */
  async findUserStatus(userId: string): Promise<string | undefined> {
    const rows: { status: string }[] = await this.dataSource.query(
      "SELECT status FROM users WHERE user_id = $1",
      [userId],
    );

    return rows[0]?.status;
  }

  /**
   * Whether an account is currently suspended.
   *
   * Deliberately narrow, and worded to match `moderationPermits` in
   * `moment.repository.ts` exactly. That SQL asks whether the author's status
   * is `suspended` and nothing else, so this must too: the two state one rule
   * in two languages, a test holds them in agreement, and a twin that also
   * caught `deactivated` would change what deactivation means as a side effect
   * of shipping moderation.
   *
   * An account that cannot be found reads as not suspended, again because the
   * SQL does. A Moment's author is guaranteed by a foreign key, so the case is
   * unreachable; matching the statement that actually governs set reads matters
   * more here than choosing a safer answer for a row that cannot exist.
   *
   * @param userId - Whose account.
   * @returns Whether it is suspended.
   */
  async isSuspended(userId: string): Promise<boolean> {
    return (await this.findUserStatus(userId)) === "suspended";
  }

  /**
   * When somebody was born, for the age gate.
   *
   * @param userId - Who is asking to see something.
   * @returns Their date of birth, or undefined when no restricted-data row
   *   exists for them. Undefined is not permission: the caller treats it as too
   *   young, which is what deny-by-default means for an age check.
   */
  async findDateOfBirth(userId: string): Promise<Date | undefined> {
    const rows: { date_of_birth: Date | string }[] = await this.dataSource.query(
      "SELECT date_of_birth FROM user_restricted_data WHERE user_id = $1",
      [userId],
    );

    const value = rows[0]?.date_of_birth;

    if (value === undefined) {
      return undefined;
    }

    // The driver hands back a `date` column as a string rather than a Date,
    // and comparing a string to an instant silently yields nonsense.
    return value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  }
}
