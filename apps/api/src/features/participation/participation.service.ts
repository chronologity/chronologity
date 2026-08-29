import { randomUUID } from "node:crypto";
import {
  MAXIMUM_PARTICIPANTS,
  PARTICIPATION_BOUNDARY,
  type MomentParticipants,
  type Participation,
  type ParticipationList,
  type ParticipationRefusalList,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { enqueueOutboxMessage } from "../../lib/database/outbox.js";
import { withTransaction, type Transaction } from "../../lib/database/transaction.js";
import { topicName } from "../../lib/messaging/topics.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination/cursor.js";
import type { MomentService } from "../moments/moment.service.js";
import type { FollowRepository } from "../social/follow.repository.js";
import type { UserRepository } from "../users/user.repository.js";
import {
  checkProposal,
  checkRemoval,
  checkResolution,
  describeProposalRejection,
  describeResolutionRejection,
} from "./participation.policy.js";
import type { ParticipationRepository, ParticipationView } from "./participation.repository.js";

/**
 * Recording that somebody was part of an experience they did not record.
 *
 * A creator proposes and only the person named may establish it. Everything
 * here follows from that: a proposal is a question addressed to one person, so
 * it is visible to two people and nobody else; an answer is theirs alone to
 * give; and a refusal cannot be repeated, because a refusal that can be
 * repeated is only a delay.
 *
 * **Nothing here grants sight of anything.** A participant may be somebody who
 * cannot read the Moment at all, and accepting changes that not at all. Whether
 * they may read it is the audience's business, which is a different table with
 * a different rule.
 */
export class ParticipationService {
  /**
   * Build the service.
   *
   * @param dataSource - For transactions.
   * @param participations - The relationship itself.
   * @param moments - Read to establish authorship. Only a Moment's creator may
   *   propose, and that is the one thing this cannot decide alone.
   * @param users - Read to establish that the person named is an account
   *   somebody may be told about.
   * @param follows - Read for Blocks, which refuse a proposal in either
   *   direction.
   * @param clock - Injected so a test can pin when something was proposed.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly participations: ParticipationRepository,
    private readonly moments: MomentService,
    private readonly users: UserRepository,
    private readonly follows: FollowRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Say that somebody was part of a Moment.
   *
   * @param momentId - Which Moment.
   * @param namedUserId - Who is said to have been there.
   * @param proposerUserId - Who is proposing, which must be the Moment's author.
   * @returns The proposal, which asserts nothing until it is answered.
   * @throws {NotFoundError} If the Moment is not theirs, if there is no such
   *   account, or if the named person has refused or blocked them — all
   *   reported alike, so neither a Moment nor a refusal can be probed for.
   * @throws {ValidationError} If they name themselves, if they have blocked the
   *   person, if the Moment is full, or if this pair has already been settled.
   */
  async propose(
    momentId: string,
    namedUserId: string,
    proposerUserId: string,
  ): Promise<Participation> {
    // Authorship, deliberately not visibility: `participation.md` permits
    // proposing in a Moment the named person cannot read, and reading it as the
    // Viewer would be right in every test where the author is the caller and
    // wrong the first time somebody else tried.
    const moment = await this.moments.getForAuthor(momentId, proposerUserId);
    const named = await this.users.findPublic(namedUserId);

    if (named === undefined) {
      throw new NotFoundError("No such user");
    }

    const [blocks, refusedMe, existing] = await Promise.all([
      this.follows.blocksBetween(proposerUserId, namedUserId),
      this.participations.hasRefused(namedUserId, proposerUserId),
      this.participations.countLive(momentId),
    ]);

    const rejection = checkProposal(
      { proposerUserId, namedUserId, authorUserId: moment.authorUserId },
      existing,
      { refusedMe, ...blocks },
    );

    if (rejection !== undefined) {
      const message = describeProposalRejection(rejection);

      // "No such user" and "No such Moment" are absences, and absences are
      // reported as absences. Everything else is something the asker may be
      // told plainly, because they already know it.
      throw message.startsWith("No such")
        ? new NotFoundError(message)
        : new ValidationError(message, { field: "userId" });
    }

    const at = this.clock();

    const participationId = await withTransaction(this.dataSource, async (tx) => {
      const proposed = await this.participations.propose(tx, momentId, namedUserId, at);

      if (proposed === undefined) {
        return undefined;
      }

      await this.announce(tx, "ParticipationProposed", {
        participationId: proposed,
        momentId,
        userId: namedUserId,
        proposedByUserId: proposerUserId,
        proposedAt: at.toISOString(),
      }, momentId, proposerUserId, at);

      return proposed;
    });

    if (participationId === undefined) {
      // The unique constraint refused, which means this pair has a row already:
      // either an unanswered proposal, or one that was rejected or withdrawn
      // and can never be proposed again.
      throw new ValidationError("This person has already been asked about this Moment", {
        field: "userId",
      });
    }

    return {
      participationId,
      momentId,
      user: named,
      proposedBy: await this.requireProposer(proposerUserId),
      status: "proposed",
      proposedAt: at.toISOString(),
    };
  }

  /**
   * Answer a proposal.
   *
   * @param participationId - Which proposal.
   * @param actorUserId - Who is answering, which must be the person named.
   * @param answer - What they said.
   * @returns Nothing.
   * @throws {NotFoundError} If it does not exist, or is not theirs to answer.
   * @throws {ValidationError} If it has already been answered.
   */
  async answer(
    participationId: string,
    actorUserId: string,
    answer: "accepted" | "rejected",
  ): Promise<void> {
    const view = await this.participationFor(participationId, actorUserId);
    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      const answered = await this.participations.answer(tx, participationId, answer, at);

      if (!answered) {
        // Somebody answered between the read and the write. The conditional
        // update is what makes that a refusal rather than an overwrite.
        throw new ValidationError(describeResolutionRejection("already_answered"), {
          field: "participationId",
        });
      }

      await this.announce(
        tx,
        answer === "accepted" ? "ParticipationAccepted" : "ParticipationRejected",
        {
          participationId,
          momentId: view.participation.momentId,
          userId: view.participation.userId,
          proposedByUserId: view.proposedBy.userId,
          [answer === "accepted" ? "acceptedAt" : "rejectedAt"]: at.toISOString(),
        },
        view.participation.momentId,
        actorUserId,
        at,
      );
    });
  }

  /**
   * Remove a participation, which is two acts sharing a verb.
   *
   * A participant **withdraws** what they accepted, and the record stays as
   * `withdrawn` so it can never be proposed again. A creator **cancels** a
   * proposal nobody answered, and that deletes the row — a retracted question
   * is not a refusal and must not spend the one chance they have.
   *
   * @param participationId - Which participation.
   * @param actorUserId - Who is removing it.
   * @returns Nothing.
   * @throws {NotFoundError} If it does not exist or is not theirs to remove.
   * @throws {ValidationError} If its state does not permit the act.
   */
  async remove(participationId: string, actorUserId: string): Promise<void> {
    const view = await this.find(participationId);

    if (view === undefined) {
      throw new NotFoundError("No such participation");
    }

    const outcome = checkRemoval(
      {
        userId: view.participation.userId,
        authorUserId: view.proposedBy.userId,
        status: view.participation.status,
      },
      actorUserId,
    );

    if ("reason" in outcome) {
      throw outcome.reason === "not_yours_to_remove"
        ? new NotFoundError("No such participation")
        : new ValidationError("That participation cannot be removed in its current state", {
            field: "participationId",
          });
    }

    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      if (outcome.act === "cancel") {
        // Nothing is announced. A question the asker took back before anybody
        // answered is not a fact about the person it named, and a message
        // saying it happened would outlive the row that did not.
        const cancelled = await this.participations.cancel(tx, participationId);

        if (!cancelled) {
          throw new ValidationError("That participation has already been answered", {
            field: "participationId",
          });
        }

        return;
      }

      const withdrawn = await this.participations.withdraw(tx, participationId, at);

      if (!withdrawn) {
        throw new ValidationError("That participation has already been answered", {
          field: "participationId",
        });
      }

      await this.announce(
        tx,
        "ParticipationWithdrawn",
        {
          participationId,
          momentId: view.participation.momentId,
          userId: view.participation.userId,
          proposedByUserId: view.proposedBy.userId,
          withdrawnAt: at.toISOString(),
        },
        view.participation.momentId,
        actorUserId,
        at,
      );
    });
  }

  /**
   * Who a Moment records as having been there.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking.
   * @returns The accepted participants. Proposals are never included: a
   *   proposal is a question between two people, and reaching it through the
   *   Moment would answer it for everybody else.
   * @throws {NotFoundError} If the Viewer may not read the Moment, which is the
   *   Moment's own rule reused rather than restated.
   */
  async participants(momentId: string, viewerUserId: string): Promise<MomentParticipants> {
    await this.moments.get(momentId, viewerUserId);

    const accepted = await this.participations.listAccepted(momentId, MAXIMUM_PARTICIPANTS);

    return {
      participants: accepted.map((row) => ({
        user: row.user,
        acceptedAt: row.acceptedAt.toISOString(),
      })),
    };
  }

  /**
   * Somebody's participations.
   *
   * @param userId - Whose.
   * @param request - Which direction, which state, and how many.
   * @returns The page, and where to resume.
   * @throws {ValidationError} If the cursor is not one this system issued.
   */
  async list(
    userId: string,
    request: {
      direction: "to-me" | "by-me";
      status?: string | undefined;
      limit: number;
      cursor?: string | undefined;
    },
  ): Promise<ParticipationList> {
    const after = request.cursor === undefined ? undefined : decodeCursor(request.cursor);
    const rows = await this.participations.list(
      userId,
      request.direction,
      request.status,
      request.limit + 1,
      after,
    );

    const page = rows.slice(0, request.limit);
    const last = page[page.length - 1];

    return {
      items: page.map((row) => present(row)),
      nextCursor:
        rows.length > request.limit && last !== undefined
          ? encodeCursor(last.participation.proposedAt, last.participation.participationId)
          : undefined,
    };
  }

  /**
   * Refuse participation proposals from somebody.
   *
   * Weaker than a Block and separate from one. Existing participations are
   * untouched: a refusal governs what may be asked from here, not what somebody
   * already agreed to.
   *
   * @param refusingUserId - Who is refusing.
   * @param refusedUserId - Who they are refusing.
   * @returns Nothing.
   * @throws {NotFoundError} If there is no such account.
   * @throws {ValidationError} If they refuse themselves.
   */
  async refuse(refusingUserId: string, refusedUserId: string): Promise<void> {
    if (refusingUserId === refusedUserId) {
      throw new ValidationError("You cannot refuse yourself", { field: "userId" });
    }

    if ((await this.users.findPublic(refusedUserId)) === undefined) {
      throw new NotFoundError("No such user");
    }

    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      await this.participations.refuse(tx, refusingUserId, refusedUserId, at);
    });
  }

  /**
   * Stop refusing somebody.
   *
   * @param refusingUserId - Who was refusing.
   * @param refusedUserId - Who they were refusing.
   * @returns Nothing.
   * @throws {NotFoundError} If no such refusal stood.
   */
  async allow(refusingUserId: string, refusedUserId: string): Promise<void> {
    const lifted = await withTransaction(this.dataSource, (tx) =>
      this.participations.allow(tx, refusingUserId, refusedUserId),
    );

    if (!lifted) {
      throw new NotFoundError("No such refusal");
    }
  }

  /**
   * Who somebody has refused.
   *
   * @param refusingUserId - Whose list. Only ever their own: who has refused
   *   *them* is not something the product will tell anybody.
   * @param request - How many, and where to resume.
   * @returns The page.
   * @throws {ValidationError} If the cursor is not one this system issued.
   */
  async listRefusals(
    refusingUserId: string,
    request: { limit: number; cursor?: string | undefined },
  ): Promise<ParticipationRefusalList> {
    const after = request.cursor === undefined ? undefined : decodeCursor(request.cursor);
    const rows = await this.participations.listRefusals(
      refusingUserId,
      request.limit + 1,
      after,
    );

    const page = rows.slice(0, request.limit);
    const last = page[page.length - 1];

    return {
      items: page.map((row) => ({ user: row.user, refusedAt: row.refusedAt.toISOString() })),
      nextCursor:
        rows.length > request.limit && last !== undefined
          ? encodeCursor(last.refusedAt, last.user.userId)
          : undefined,
    };
  }

  /**
   * Read a participation somebody is entitled to act on.
   *
   * @param participationId - Which participation.
   * @param actorUserId - Who is asking.
   * @returns It, when it is theirs to answer.
   * @throws {NotFoundError} If it does not exist or is not theirs — reported
   *   alike, so identifiers cannot be probed.
   * @throws {ValidationError} If it has already been answered.
   */
  private async participationFor(
    participationId: string,
    actorUserId: string,
  ): Promise<ParticipationView> {
    const view = await this.find(participationId);

    if (view === undefined) {
      throw new NotFoundError("No such participation");
    }

    const rejection = checkResolution(
      { userId: view.participation.userId, status: view.participation.status },
      actorUserId,
    );

    if (rejection === "not_yours_to_answer") {
      throw new NotFoundError(describeResolutionRejection(rejection));
    }

    if (rejection === "already_answered") {
      throw new ValidationError(describeResolutionRejection(rejection), {
        field: "participationId",
      });
    }

    return view;
  }

  /**
   * Read a participation.
   *
   * @param participationId - Which participation.
   * @returns It, or undefined.
   */
  private async find(participationId: string): Promise<ParticipationView | undefined> {
    return this.participations.find(participationId);
  }

  /**
   * The proposer, as anybody may see them.
   *
   * @param userId - Who proposed.
   * @returns Their public profile.
   * @throws {NotFoundError} If the account has gone, which cannot happen on the
   *   path that calls this — they authenticated a moment ago.
   */
  private async requireProposer(userId: string) {
    const proposer = await this.users.findPublic(userId);

    if (proposer === undefined) {
      throw new NotFoundError("No such user");
    }

    return proposer;
  }

  /**
   * Announce a participation change.
   *
   * Partitioned on the Moment rather than on either person, so every change to
   * one Moment's participations stays ordered: a proposal and the answer to it
   * must not be able to arrive the wrong way round.
   *
   * The payload carries identifiers and nothing the Moment says. These land on
   * a topic with its own retention, and the person named frequently cannot read
   * the Moment — a message is the last place to put what every read surface is
   * careful about.
   *
   * @param tx - The caller's transaction, so the message and the change it
   *   describes are enqueued together or not at all.
   * @param eventType - Which participation event this is.
   * @param payload - What it says.
   * @param momentId - What to partition on.
   * @param actorUserId - Who acted.
   * @param at - When.
   * @returns Nothing.
   */
  private async announce(
    tx: Transaction,
    eventType: string,
    payload: Record<string, unknown>,
    momentId: string,
    actorUserId: string,
    at: Date,
  ): Promise<void> {
    const traceId = randomUUID();

    await enqueueOutboxMessage(tx, {
      topic: topicName(PARTICIPATION_BOUNDARY),
      partitionKey: momentId,
      aggregateType: "participation",
      aggregateId: payload.participationId as string,
      aggregateVersion: 0,
      eventType,
      eventVersion: 1,
      payload,
      metadata: {
        traceId,
        correlationId: traceId,
        causationId: undefined,
        actorUserId,
        eventVersion: 1,
        recordedAt: at.toISOString(),
      },
    });
  }
}

/**
 * A participation as the contract presents it.
 *
 * @param view - The row and the two people it concerns.
 * @returns The contract shape.
 */
function present(view: ParticipationView): Participation {
  return {
    participationId: view.participation.participationId,
    momentId: view.participation.momentId,
    user: view.named,
    proposedBy: view.proposedBy,
    status: view.participation.status as Participation["status"],
    proposedAt: view.participation.proposedAt.toISOString(),
    ...(view.participation.resolvedAt === null
      ? {}
      : { resolvedAt: view.participation.resolvedAt.toISOString() }),
  };
}
