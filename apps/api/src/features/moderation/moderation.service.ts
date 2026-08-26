import type {
  AccuracyReport,
  AccuracyReportPage,
  Appeal,
  AppealPage,
  DecideAppealRequest,
  ModerationReport,
  ModerationReportPage,
  ModerationState,
  ModerationSubjectState,
  ModerationSubjectType,
  OwnModerationHistoryPage,
  OwnModerationRecord,
  OwnReport,
  OwnReportPage,
  ReportReason,
  ReportStatus,
  SetModerationStateRequest,
  SubmitAccuracyReportRequest,
  SubmitAppealRequest,
  SubmitReportRequest,
  Suspension,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { generateId } from "../../lib/ids/generate-id.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination/cursor.js";
import { withTransaction } from "../../lib/database/transaction.js";
import type {
  AccuracyReportRow,
  ModerationAppeal,
  ModerationReportRow,
} from "./moderation.model.js";
import type { ModerationRepository } from "./moderation.repository.js";
import { appealReverses, isBurst, mayTransitionReport, reviewPriority } from "./moderation.policy.js";

/** What a moderator's decision needs to know about who is making it. */
interface Actor {
  readonly userId: string;
}

/**
 * Reporting, moderating, suspending, and appealing.
 *
 * The distinction everything here rests on: moderation decides what
 * Chronologity distributes, not what happened (`moderation.md:151`). Nothing in
 * this service alters occurrence, authorship, or a Moment's position in
 * chronology, and nothing deletes. A removed Moment is hidden, its author still
 * reads it, and reversing the decision restores it — which is what makes an
 * appeal something other than a formality.
 *
 * Reporting and deciding are deliberately far apart. A report changes no state:
 * `moderation.md:614` says report volume "may affect review prioritization" but
 * must never establish that content violates policy, so volume reaches the
 * queue's ordering and stops there.
 */
export class ModerationService {
  /**
   * Build the moderation service.
   *
   * @param dataSource - Opens transactions. A decision and the record of it
   *   share one, so a state can never exist with no audit trail behind it.
   * @param moderation - Where moderation records are read and written.
   * @param now - Reads the clock, injected so the burst window and the age
   *   boundary can be tested.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly moderation: ModerationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Report something.
   *
   * Filing the same report twice returns the first one rather than failing. The
   * unique constraint is there to stop one account manufacturing volume, not to
   * scold somebody who tapped twice or forgot they had already reported this;
   * either way what they wanted — that Chronologity knows — is already true.
   *
   * @param reporterUserId - Who is reporting.
   * @param request - What, and why.
   * @returns Their report as they may see it.
   * @throws {NotFoundError} If there is no such subject. Reported identically
   *   to a subject they cannot see, so reporting cannot be used to discover
   *   what exists.
   */
  async report(reporterUserId: string, request: SubmitReportRequest): Promise<OwnReport> {
    const owner = await this.moderation.findSubjectOwner(request.subjectType, request.subjectId);

    if (owner === undefined) {
      throw new NotFoundError("No such subject");
    }

    const at = this.now();
    const reportId = generateId();

    const written = await withTransaction(this.dataSource, (tx) =>
      this.moderation.insertReport(tx, {
        reportId,
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        reporterUserId,
        reason: request.reason,
        detail: request.detail ?? null,
        status: "submitted",
        priority: "normal",
        createdAt: at,
      }),
    );

    if (!written) {
      const existing = await this.moderation.findReportBy(
        request.subjectType,
        request.subjectId,
        reporterUserId,
      );

      if (existing === undefined) {
        // The constraint refused an insert and the row is not there, which
        // means it was removed between the two statements. Nothing sensible
        // remains to return.
        throw new NotFoundError("No such subject");
      }

      return toOwnReport(existing);
    }

    // Reprioritised after the write, so the count includes this report. This
    // is the whole of the automation the feature has: it orders a queue and
    // touches no state.
    await this.reprioritise(request.subjectType, request.subjectId, request.reason);

    const stored = await this.moderation.findReport(reportId);

    return stored === undefined
      ? {
          reportId,
          subjectType: request.subjectType,
          subjectId: request.subjectId,
          reason: request.reason,
          status: "submitted",
          createdAt: at.toISOString(),
          resolvedAt: null,
        }
      : toOwnReport(stored);
  }

  /**
   * Recompute where a subject's open reports sit in the queue.
   *
   * @param subjectType - What kind of thing.
   * @param subjectId - Which one.
   * @param reason - The reason the latest reporter gave.
   * @returns Nothing.
   */
  private async reprioritise(
    subjectType: string,
    subjectId: string,
    reason: ReportReason,
  ): Promise<void> {
    const times = await this.moderation.reportTimesFor(subjectType, subjectId);
    const priority = reviewPriority(times.length, reason);

    await withTransaction(this.dataSource, (tx) =>
      this.moderation.setPriorityFor(tx, subjectType, subjectId, priority),
    );
  }

  /**
   * The reports somebody filed.
   *
   * @param reporterUserId - Who filed them.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page, newest first.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async listOwnReports(
    reporterUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<OwnReportPage> {
    const rows = await this.moderation.listReportsBy(reporterUserId, limit, decodeCursor(cursor));
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return {
      reports: rows.map(toOwnReport),
      ...(last === undefined
        ? {}
        : { nextCursor: encodeCursor(last.createdAt, last.reportId) }),
    };
  }

  /**
   * One report somebody filed.
   *
   * @param reportId - Which report.
   * @param reporterUserId - Who is asking.
   * @returns Their report, carrying status and nothing more.
   * @throws {NotFoundError} If there is no such report or it is not theirs.
   *   Somebody else's report is reported as absent rather than forbidden: that
   *   a report exists about a given subject is itself something a reporter is
   *   not entitled to learn.
   */
  async getOwnReport(reportId: string, reporterUserId: string): Promise<OwnReport> {
    const report = await this.moderation.findReport(reportId);

    if (report === undefined || report.reporterUserId !== reporterUserId) {
      throw new NotFoundError("No such report");
    }

    return toOwnReport(report);
  }

  /**
   * Report that a Moment is wrong about history.
   *
   * @param reporterUserId - Who is reporting.
   * @param request - Which Moment, what is wrong, and what is right instead.
   * @returns The accuracy report.
   * @throws {NotFoundError} If there is no such Moment.
   */
  async reportAccuracy(
    reporterUserId: string,
    request: SubmitAccuracyReportRequest,
  ): Promise<AccuracyReport> {
    const owner = await this.moderation.findSubjectOwner("moment", request.momentId);

    if (owner === undefined) {
      throw new NotFoundError("No such moment");
    }

    const at = this.now();
    const reportId = generateId();

    const written = await withTransaction(this.dataSource, (tx) =>
      this.moderation.insertAccuracyReport(tx, {
        reportId,
        momentId: request.momentId,
        reporterUserId,
        reason: request.reason,
        detail: request.detail,
        status: "submitted",
        createdAt: at,
      }),
    );

    if (!written) {
      const existing = await this.moderation.findAccuracyReportBy(
        request.momentId,
        reporterUserId,
      );

      if (existing === undefined) {
        throw new NotFoundError("No such moment");
      }

      return toAccuracyReport(existing);
    }

    return {
      reportId,
      momentId: request.momentId,
      reporterUserId,
      reason: request.reason,
      detail: request.detail,
      status: "submitted",
      createdAt: at.toISOString(),
      resolvedAt: null,
    };
  }

  /**
   * The accuracy reports somebody filed.
   *
   * @param reporterUserId - Who filed them.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page, newest first.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async listOwnAccuracyReports(
    reporterUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<AccuracyReportPage> {
    const rows = await this.moderation.listAccuracyReportsBy(
      reporterUserId,
      limit,
      decodeCursor(cursor),
    );
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return {
      reports: rows.map(toAccuracyReport),
      ...(last === undefined ? {} : { nextCursor: encodeCursor(last.createdAt, last.reportId) }),
    };
  }

  /**
   * One accuracy report somebody filed.
   *
   * @param reportId - Which report.
   * @param reporterUserId - Who is asking.
   * @returns The report.
   * @throws {NotFoundError} If there is no such report or it is not theirs.
   */
  async getOwnAccuracyReport(reportId: string, reporterUserId: string): Promise<AccuracyReport> {
    const report = await this.moderation.findAccuracyReport(reportId);

    if (report === undefined || report.reporterUserId !== reporterUserId) {
      throw new NotFoundError("No such report");
    }

    return toAccuracyReport(report);
  }

  /**
   * What was done to somebody's own content, and why.
   *
   * What makes an appeal possible: nobody can contest a decision they were
   * never told about. Refused attempts are excluded — those are evidence for a
   * security review, and telling somebody that a person without the permission
   * tried to moderate them would announce an attempt rather than a decision.
   *
   * @param userId - Whose content.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page, newest first, each record carrying whether it has been
   *   appealed and how that went.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async ownHistory(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<OwnModerationHistoryPage> {
    const actions = await this.moderation.listActionsAffecting(userId, limit, decodeCursor(cursor));
    const appeals = await this.moderation.findAppealsForActions(
      actions.map((action) => action.actionId),
    );

    const records: OwnModerationRecord[] = actions.map((action) => {
      const appeal = appeals.get(action.actionId);

      return {
        actionId: action.actionId,
        subjectType: action.subjectType as ModerationSubjectType,
        subjectId: action.subjectId,
        state: (action.state ?? "removed") as ModerationState,
        reason: action.reason,
        decidedAt: action.occurredAt.toISOString(),
        appealStatus:
          appeal === undefined
            ? "none"
            : appeal.status === "open"
              ? "open"
              : appeal.outcome === "reversed"
                ? "reversed"
                : "upheld",
      };
    });

    const last = actions.length === limit ? actions[actions.length - 1] : undefined;

    return {
      records,
      ...(last === undefined ? {} : { nextCursor: encodeCursor(last.occurredAt, last.actionId) }),
    };
  }

  /**
   * Contest something done to you.
   *
   * @param appellantUserId - Who is appealing.
   * @param request - Which action, and what they want to say about it.
   * @returns The appeal.
   * @throws {NotFoundError} If there is no such action, or it was not against
   *   them. Somebody else's action is reported as absent: which decisions have
   *   been made about other people is not theirs to learn.
   * @throws {ValidationError} If an appeal against this action is already open.
   *   Refused rather than silently discarded, because an appeal carries a
   *   statement somebody wrote and swallowing it would lose what they said.
   */
  async appeal(appellantUserId: string, request: SubmitAppealRequest): Promise<Appeal> {
    const action = await this.moderation.findAction(request.actionId);

    if (
      action === undefined ||
      action.affectedUserId !== appellantUserId ||
      action.outcome !== "success"
    ) {
      throw new NotFoundError("No such action");
    }

    const at = this.now();
    const appealId = generateId();

    const written = await withTransaction(this.dataSource, (tx) =>
      this.moderation.insertAppeal(tx, {
        appealId,
        actionId: request.actionId,
        appellantUserId,
        statement: request.statement,
        status: "open",
        createdAt: at,
      }),
    );

    if (!written) {
      throw new ValidationError("That decision is already under appeal", { field: "actionId" });
    }

    return {
      appealId,
      actionId: request.actionId,
      appellantUserId,
      statement: request.statement,
      status: "open",
      outcome: null,
      resolution: null,
      createdAt: at.toISOString(),
      decidedAt: null,
    };
  }

  /**
   * The appeals somebody filed.
   *
   * @param appellantUserId - Who filed them.
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page, newest first.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async listOwnAppeals(
    appellantUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<AppealPage> {
    const rows = await this.moderation.listAppealsBy(appellantUserId, limit, decodeCursor(cursor));
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return {
      appeals: rows.map(toAppeal),
      ...(last === undefined ? {} : { nextCursor: encodeCursor(last.createdAt, last.appealId) }),
    };
  }

  /**
   * One appeal somebody filed.
   *
   * @param appealId - Which appeal.
   * @param appellantUserId - Who is asking.
   * @returns The appeal, outcome included once there is one.
   * @throws {NotFoundError} If there is no such appeal or it is not theirs.
   */
  async getOwnAppeal(appealId: string, appellantUserId: string): Promise<Appeal> {
    const appeal = await this.moderation.findAppeal(appealId);

    if (appeal === undefined || appeal.appellantUserId !== appellantUserId) {
      throw new NotFoundError("No such appeal");
    }

    return toAppeal(appeal);
  }

  /**
   * The safety queue.
   *
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page, oldest first, each report carrying how many separate
   *   people reported the subject and whether they arrived together.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async listQueue(limit: number, cursor?: string): Promise<ModerationReportPage> {
    const rows = await this.moderation.listOpenReports(limit, decodeCursor(cursor));
    const reports = await Promise.all(rows.map((row) => this.describeReport(row)));
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return {
      reports,
      ...(last === undefined ? {} : { nextCursor: encodeCursor(last.createdAt, last.reportId) }),
    };
  }

  /**
   * One report, as a moderator sees it.
   *
   * @param reportId - Which report.
   * @returns The report, reporter included.
   * @throws {NotFoundError} If there is no such report.
   */
  async getReport(reportId: string): Promise<ModerationReport> {
    const report = await this.moderation.findReport(reportId);

    if (report === undefined) {
      throw new NotFoundError("No such report");
    }

    return this.describeReport(report);
  }

  /**
   * Fill in what a moderator needs beyond the row itself.
   *
   * @param row - The stored report.
   * @returns It, with the subject's report count and burst flag.
   */
  private async describeReport(row: ModerationReportRow): Promise<ModerationReport> {
    const times = await this.moderation.reportTimesFor(row.subjectType, row.subjectId);

    return {
      reportId: row.reportId,
      subjectType: row.subjectType as ModerationSubjectType,
      subjectId: row.subjectId,
      reporterUserId: row.reporterUserId,
      reason: row.reason as ReportReason,
      detail: row.detail,
      status: row.status as ReportStatus,
      priority: row.priority as ModerationReport["priority"],
      reportCount: Math.max(times.length, 1),
      burst: isBurst(times, this.now()),
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }

  /**
   * Move a report through its statuses.
   *
   * Deciding a report and moderating its subject are separate acts: a report
   * can be closed with nothing done, because "no violation" is a real outcome
   * and the alternative is a system where reporting somebody is itself a
   * penalty.
   *
   * @param reportId - Which report.
   * @param to - Where it is going.
   * @returns The report as it now stands.
   * @throws {NotFoundError} If there is no such report.
   * @throws {ValidationError} If the move is not one the status allows, or if
   *   another moderator moved it first.
   */
  async transitionReport(reportId: string, to: ReportStatus): Promise<ModerationReport> {
    const report = await this.moderation.findReport(reportId);

    if (report === undefined) {
      throw new NotFoundError("No such report");
    }

    if (!mayTransitionReport(report.status as ReportStatus, to)) {
      throw new ValidationError("That report cannot move to that status", { field: "status" });
    }

    const moved = await withTransaction(this.dataSource, (tx) =>
      this.moderation.transitionReport(tx, reportId, report.status, to, this.now()),
    );

    if (!moved) {
      throw new ValidationError("That report has already been dealt with", { field: "status" });
    }

    return this.getReport(reportId);
  }

  /**
   * The accuracy queue.
   *
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page, oldest first. Holds no safety reports: they live in a
   *   different table, so the separation is structural rather than a filter
   *   somebody could forget to apply.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async listAccuracyQueue(limit: number, cursor?: string): Promise<AccuracyReportPage> {
    const rows = await this.moderation.listOpenAccuracyReports(limit, decodeCursor(cursor));
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return {
      reports: rows.map(toAccuracyReport),
      ...(last === undefined ? {} : { nextCursor: encodeCursor(last.createdAt, last.reportId) }),
    };
  }

  /**
   * One accuracy report, as a moderator sees it.
   *
   * @param reportId - Which report.
   * @returns The report.
   * @throws {NotFoundError} If there is no such report.
   */
  async getAccuracyReport(reportId: string): Promise<AccuracyReport> {
    const report = await this.moderation.findAccuracyReport(reportId);

    if (report === undefined) {
      throw new NotFoundError("No such report");
    }

    return toAccuracyReport(report);
  }

  /**
   * Move an accuracy report through its statuses.
   *
   * Nothing here reaches a moderation state. `moderation.md:527` holds a
   * historical correction apart from a moderation action: resolving one of
   * these means a reviewer has looked at a claim about the past, and the
   * correction itself belongs to the Moment's author.
   *
   * @param reportId - Which report.
   * @param to - Where it is going.
   * @returns The report as it now stands.
   * @throws {NotFoundError} If there is no such report.
   * @throws {ValidationError} If the move is not one the status allows, or if
   *   another moderator moved it first.
   */
  async transitionAccuracyReport(reportId: string, to: ReportStatus): Promise<AccuracyReport> {
    const report = await this.moderation.findAccuracyReport(reportId);

    if (report === undefined) {
      throw new NotFoundError("No such report");
    }

    if (!mayTransitionReport(report.status as ReportStatus, to)) {
      throw new ValidationError("That report cannot move to that status", { field: "status" });
    }

    const moved = await withTransaction(this.dataSource, (tx) =>
      this.moderation.transitionAccuracyReport(tx, reportId, report.status, to, this.now()),
    );

    if (!moved) {
      throw new ValidationError("That report has already been dealt with", { field: "status" });
    }

    return this.getAccuracyReport(reportId);
  }

  /**
   * Put something into a moderation state.
   *
   * Setting `allowed` clears the state rather than storing it, keeping one
   * meaning for an absent row. What was decided survives in the actions table
   * either way, which is the record that must not be erasable.
   *
   * @param subjectType - What kind of thing.
   * @param subjectId - Which one.
   * @param request - The state, and why.
   * @param actor - The moderator deciding.
   * @returns What Chronologity is now doing about it.
   * @throws {NotFoundError} If there is no such subject.
   */
  async setState(
    subjectType: ModerationSubjectType,
    subjectId: string,
    request: SetModerationStateRequest,
    actor: Actor,
  ): Promise<ModerationSubjectState> {
    const owner = await this.moderation.findSubjectOwner(subjectType, subjectId);

    if (owner === undefined) {
      throw new NotFoundError("No such subject");
    }

    const at = this.now();

    // Whether moderating this medium would leave its Moment with none.
    // Answered before the transaction because it reads a count the decision
    // then invalidates, and inside it the two would deadlock against the write.
    const orphansMoment =
      subjectType === "media" &&
      owner.momentId !== undefined &&
      (request.state === "removed" || request.state === "temporarily_unavailable") &&
      (await this.moderation.countRemainingMedia(owner.momentId, subjectId)) === 0;

    await withTransaction(this.dataSource, async (tx) => {
      if (request.state === "allowed") {
        await this.moderation.clearState(tx, subjectType, subjectId);
      } else {
        await this.moderation.setState(tx, {
          subjectType,
          subjectId,
          state: request.state,
          reason: request.reason,
          decidedByUserId: actor.userId,
          decidedAt: at,
        });
      }

      await this.moderation.recordAction(tx, {
        actionId: generateId(),
        subjectType,
        subjectId,
        state: request.state,
        affectedUserId: owner.ownerUserId,
        actorUserId: actor.userId,
        actorKind: "human",
        outcome: "success",
        reason: request.reason,
        occurredAt: at,
      });

      if (orphansMoment && owner.momentId !== undefined) {
        // A Moment cannot exist without media — 5H refuses removing the last
        // one — so a Moment whose last medium has been moderated away cannot
        // stay readable. The cascade is forced by that existing invariant
        // rather than invented here, and leaving it out would produce a Moment
        // the system says could not have been created.
        await this.moderation.setState(tx, {
          subjectType: "moment",
          subjectId: owner.momentId,
          state: "temporarily_unavailable",
          reason: "Its last remaining medium was moderated",
          decidedByUserId: actor.userId,
          decidedAt: at,
        });

        await this.moderation.recordAction(tx, {
          actionId: generateId(),
          subjectType: "moment",
          subjectId: owner.momentId,
          state: "temporarily_unavailable",
          affectedUserId: owner.ownerUserId,
          actorUserId: actor.userId,
          actorKind: "human",
          outcome: "success",
          reason: "Its last remaining medium was moderated",
          occurredAt: at,
        });
      }

      // Acting on a subject settles the reports about it. Otherwise the queue
      // fills with work already done and every reporter's status view sits at
      // "submitted" indefinitely.
      await this.moderation.resolveOpenReportsFor(tx, subjectType, subjectId, at);
    });

    return {
      subjectType,
      subjectId,
      state: request.state,
      decidedAt: at.toISOString(),
    };
  }

  /**
   * Suspend an account, or let it back.
   *
   * Hides what the account contributed and deletes none of it, which
   * `moderation.md:687` requires — "the default should not be an accidental
   * cascade deletion" — and which `social-graph.md:486` reinforces for
   * relationships: the account may come back, and history it was part of must
   * be there when it does.
   *
   * The suspended person keeps reading their own history. They are restricted,
   * not erased, and somebody who cannot see what was hidden cannot meaningfully
   * appeal it.
   *
   * @param userId - Whose account.
   * @param suspended - Whether it should be suspended.
   * @param reason - Why.
   * @param actor - The moderator deciding.
   * @returns Whether the account is now suspended.
   * @throws {NotFoundError} If there is no such account.
   * @throws {ValidationError} If the account is deactivated, which is the
   *   person's own decision and not a state moderation should quietly overwrite.
   */
  async setSuspension(
    userId: string,
    suspended: boolean,
    reason: string,
    actor: Actor,
  ): Promise<Suspension> {
    const status = await this.moderation.findUserStatus(userId);

    if (status === undefined) {
      throw new NotFoundError("No such user");
    }

    if (status === "deactivated") {
      throw new ValidationError("That account is deactivated", { field: "userId" });
    }

    const from = suspended ? "active" : "suspended";
    const to = suspended ? "suspended" : "active";

    if (status === to) {
      // Already there. PUT declares a desired state, so this is success, and
      // writing an action for a decision nobody made would put noise into the
      // record somebody reads when they ask what happened to them.
      return { userId, suspended };
    }

    const at = this.now();

    await withTransaction(this.dataSource, async (tx) => {
      const moved = await this.moderation.transitionUserStatus(tx, userId, from, to);

      if (!moved) {
        throw new ValidationError("That account changed while this was decided", {
          field: "userId",
        });
      }

      await this.moderation.recordAction(tx, {
        actionId: generateId(),
        subjectType: "user",
        subjectId: userId,
        state: null,
        affectedUserId: userId,
        actorUserId: actor.userId,
        actorKind: "human",
        outcome: "success",
        reason,
        occurredAt: at,
      });
    });

    return { userId, suspended };
  }

  /**
   * The appeal queue.
   *
   * @param limit - How many at most.
   * @param cursor - Where to continue from, or undefined for the first page.
   * @returns The page, oldest first.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async listAppealQueue(limit: number, cursor?: string): Promise<AppealPage> {
    const rows = await this.moderation.listOpenAppeals(limit, decodeCursor(cursor));
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return {
      appeals: rows.map(toAppeal),
      ...(last === undefined ? {} : { nextCursor: encodeCursor(last.createdAt, last.appealId) }),
    };
  }

  /**
   * One appeal, as a moderator sees it.
   *
   * @param appealId - Which appeal.
   * @returns The appeal.
   * @throws {NotFoundError} If there is no such appeal.
   */
  async getAppeal(appealId: string): Promise<Appeal> {
    const appeal = await this.moderation.findAppeal(appealId);

    if (appeal === undefined) {
      throw new NotFoundError("No such appeal");
    }

    return toAppeal(appeal);
  }

  /**
   * Decide an appeal.
   *
   * Reversing restores what the action restricted. That restoration is possible
   * only because moderation hid things rather than destroying them, and it is
   * where "nothing was deleted" stops being a claim and becomes something a
   * test can check.
   *
   * @param appealId - Which appeal.
   * @param request - The outcome and the explanation.
   * @param actor - The moderator deciding.
   * @returns The appeal as it now stands.
   * @throws {NotFoundError} If there is no such appeal.
   * @throws {ValidationError} If it has already been decided.
   */
  async decideAppeal(
    appealId: string,
    request: DecideAppealRequest,
    actor: Actor,
  ): Promise<Appeal> {
    const appeal = await this.moderation.findAppeal(appealId);

    if (appeal === undefined) {
      throw new NotFoundError("No such appeal");
    }

    if (appeal.status !== "open") {
      throw new ValidationError("That appeal has already been decided", { field: "outcome" });
    }

    const action = await this.moderation.findAction(appeal.actionId);
    const at = this.now();

    await withTransaction(this.dataSource, async (tx) => {
      const decided = await this.moderation.decideAppeal(
        tx,
        appealId,
        request.outcome,
        request.resolution,
        actor.userId,
        at,
      );

      if (!decided) {
        throw new ValidationError("That appeal has already been decided", { field: "outcome" });
      }

      if (!appealReverses(request.outcome) || action === undefined) {
        return;
      }

      if (action.subjectType === "user") {
        // A reversed suspension. The status returns and the relationships,
        // Moments, and comments come back with it, none of them having been
        // touched in the first place.
        await this.moderation.transitionUserStatus(tx, action.subjectId, "suspended", "active");
      } else {
        await this.moderation.clearState(tx, action.subjectType, action.subjectId);
      }

      await this.moderation.recordAction(tx, {
        actionId: generateId(),
        subjectType: action.subjectType,
        subjectId: action.subjectId,
        state: action.subjectType === "user" ? null : "allowed",
        affectedUserId: action.affectedUserId,
        actorUserId: actor.userId,
        actorKind: "human",
        outcome: "success",
        reason: request.resolution,
        occurredAt: at,
      });
    });

    return this.getAppeal(appealId);
  }

  /**
   * Write down that somebody without the permission tried to moderate something.
   *
   * Follows `authorization_audit_events`, where a refused role grant is
   * recorded on the reasoning that an attempted self-escalation is exactly what
   * a security review wants to find afterwards. Somebody probing whether they
   * can suspend an account is the same kind of evidence.
   *
   * Never reported to the person the attempt was aimed at: their own moderation
   * history carries decisions, and announcing an attempt that was refused would
   * tell them something happened when nothing did.
   *
   * @param subjectType - What they tried to moderate.
   * @param subjectId - Which one.
   * @param actorUserId - Who tried.
   * @param reason - What they were attempting.
   * @returns Nothing. Recording is best effort by design: a failure to write
   *   the evidence must not turn a refusal into a server error, since that
   *   would tell the caller their attempt was unusual.
   */
  async recordRefusal(
    subjectType: string,
    subjectId: string,
    actorUserId: string,
    reason: string,
  ): Promise<void> {
    const owner = await this.moderation.findSubjectOwner(subjectType, subjectId);

    await withTransaction(this.dataSource, (tx) =>
      this.moderation.recordAction(tx, {
        actionId: generateId(),
        subjectType,
        subjectId,
        state: null,
        affectedUserId: owner?.ownerUserId ?? null,
        actorUserId,
        actorKind: "human",
        outcome: "failure",
        reason,
        occurredAt: this.now(),
      }),
    );
  }
}

/**
 * A stored report as the person who filed it may see it.
 *
 * @param row - The stored report.
 * @returns Status and nothing more: no reviewer, no priority, no burst flag,
 *   and nothing about the person reported. `moderation.md:637` limits a
 *   reporter to what they are entitled to receive, and everything omitted here
 *   is either internal or about somebody else.
 */
function toOwnReport(row: ModerationReportRow): OwnReport {
  return {
    reportId: row.reportId,
    subjectType: row.subjectType as ModerationSubjectType,
    subjectId: row.subjectId,
    reason: row.reason as ReportReason,
    status: row.status as ReportStatus,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

/**
 * A stored accuracy report at the boundary.
 *
 * @param row - The stored report.
 * @returns It, unredacted. An accuracy report is a claim about history rather
 *   than about a person, so there is nothing in it a reporter must be shielded
 *   from and no second shape to maintain.
 */
function toAccuracyReport(row: AccuracyReportRow): AccuracyReport {
  return {
    reportId: row.reportId,
    momentId: row.momentId,
    reporterUserId: row.reporterUserId,
    reason: row.reason as AccuracyReport["reason"],
    detail: row.detail,
    status: row.status as ReportStatus,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

/**
 * A stored appeal at the boundary.
 *
 * @param row - The stored appeal.
 * @returns It. One shape for the appellant and the moderator: an appeal is
 *   about a decision Chronologity made, so there is no third party in it to
 *   protect.
 */
function toAppeal(row: ModerationAppeal): Appeal {
  return {
    appealId: row.appealId,
    actionId: row.actionId,
    appellantUserId: row.appellantUserId,
    statement: row.statement,
    status: row.status as Appeal["status"],
    outcome: (row.outcome ?? null) as Appeal["outcome"],
    resolution: row.resolution,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}
