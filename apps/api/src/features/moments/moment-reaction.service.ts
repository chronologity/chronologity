import { randomUUID } from "node:crypto";
import type {
  ReactionKind,
  ReactionSummary,
  SetReactionsEnabledRequest,
} from "@chronologity/contracts";
import { REACTIONS_BOUNDARY } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction, type Transaction } from "../../lib/database/transaction.js";
import { enqueueOutboxMessage } from "../../lib/database/outbox.js";
import { topicName } from "../../lib/messaging/topics.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import type { FollowRepository } from "../social/follow.repository.js";
import {
  checkReaction,
  describeReactionRefusal,
} from "./moment-reaction.policy.js";
import type { MomentReactionRepository } from "./moment-reaction.repository.js";
import type { MomentRepository } from "./moment.repository.js";
import type { MomentService } from "./moment.service.js";

/**
 * Responding to a Moment.
 *
 * A Reaction is social activity, not historical occurrence
 * (`reactions.md:43`), and it never changes where a Moment sits in chronology.
 *
 * Counts, never identities. `reactions.md:307` asks that displaying an
 * aggregate and displaying exactly who reacted be treated as different
 * decisions, and on a restricted Moment a list of reactors would reveal that
 * Moment's audience to everybody on it.
 */
export class MomentReactionService {
  /**
   * Build the reaction service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param reactions - Where reactions are stored.
   * @param moments - Reads the Moment's own state, including whether it accepts
   *   reactions.
   * @param momentAccess - Proves the Moment is one this Viewer may see. Reused
   *   rather than reimplemented: a Reaction cannot be more visible than what it
   *   belongs to (`reactions.md:252`), and `get` already refuses exactly as
   *   needed.
   * @param follows - Used to ask whether a Block separates two people.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly reactions: MomentReactionRepository,
    private readonly moments: MomentRepository,
    private readonly momentAccess: MomentService,
    private readonly follows: FollowRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Leave or change your reaction to a Moment.
   *
   * @param momentId - What is being reacted to.
   * @param viewerUserId - Who is reacting.
   * @param kind - Which of the four.
   * @returns How the Moment now stands, including your own.
   * @throws {NotFoundError} If there is no such Moment or you may not see it.
   * @throws {ValidationError} If the Moment is not accepting reactions, or a
   *   Block separates you from its author. Both answer the same way: naming a
   *   Block would tell somebody they have been blocked.
   */
  async react(
    momentId: string,
    viewerUserId: string,
    kind: ReactionKind,
  ): Promise<ReactionSummary> {
    const moment = await this.momentAccess.get(momentId, viewerUserId);
    const enabled = await this.moments.acceptsReactions(momentId);

    const refusal = checkReaction(kind, {
      reactionsEnabled: enabled,
      blockedEitherWay: await this.isBlocked(moment.authorUserId, viewerUserId),
    });

    if (refusal !== undefined) {
      throw new ValidationError(describeReactionRefusal(refusal), { field: "kind" });
    }

    await withTransaction(this.dataSource, async (tx) => {
      await this.reactions.set(tx, momentId, viewerUserId, kind, this.clock());
      // Announced whether or not it replaced an earlier reaction. Changing your
      // mind from `amused` to `saddened` is a different thing to have said, and
      // the author is no more notified twice for it than for anything else —
      // the unread entry they already have absorbs it.
      await this.announce(tx, momentId, moment.authorUserId, viewerUserId, kind);
    });

    return this.reactions.summarise(momentId, viewerUserId, enabled);
  }

  /**
   * Take your reaction back.
   *
   * @param momentId - What you reacted to.
   * @param viewerUserId - Who is withdrawing.
   * @returns How the Moment now stands.
   * @throws {NotFoundError} If there is no such Moment or you may not see it.
   */
  async withdraw(momentId: string, viewerUserId: string): Promise<ReactionSummary> {
    await this.momentAccess.get(momentId, viewerUserId);

    await withTransaction(this.dataSource, (tx) =>
      this.reactions.remove(tx, momentId, viewerUserId),
    );

    // Withdrawing is permitted even where reacting is not: somebody blocked
    // after leaving a reaction, or reacting before an author disabled them,
    // must still be able to take it back.
    return this.reactions.summarise(
      momentId,
      viewerUserId,
      await this.moments.acceptsReactions(momentId),
    );
  }

  /**
   * Read how a Moment has been responded to.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking.
   * @returns The counts, the total, whether reactions are enabled, and your
   *   own. A disabled Moment reports `enabled: false` with nothing counted,
   *   because "reactions are off" and "nobody has reacted" are different facts.
   * @throws {NotFoundError} If there is no such Moment or you may not see it.
   */
  async summary(momentId: string, viewerUserId: string): Promise<ReactionSummary> {
    await this.momentAccess.get(momentId, viewerUserId);

    return this.reactions.summarise(
      momentId,
      viewerUserId,
      await this.moments.acceptsReactions(momentId),
    );
  }

  /**
   * Turn reactions on or off for a Moment.
   *
   * @param momentId - Which Moment.
   * @param authorUserId - Who is asking. Only its author may.
   * @param request - Whether to accept reactions.
   * @returns How the Moment now stands.
   * @throws {NotFoundError} If there is no such Moment, or it is not theirs.
   */
  async setEnabled(
    momentId: string,
    authorUserId: string,
    request: SetReactionsEnabledRequest,
  ): Promise<ReactionSummary> {
    await this.momentAccess.getForAuthor(momentId, authorUserId);

    await withTransaction(this.dataSource, (tx) =>
      this.reactions.setEnabled(tx, momentId, request.enabled, this.clock()),
    );

    // Nothing was deleted, so re-enabling brings the same counts back.
    return this.reactions.summarise(momentId, authorUserId, request.enabled);
  }

  /**
   * Tell the rest of the system somebody responded to a Moment.
   *
   * Enqueued in the caller's transaction, so the reaction and the event commit
   * together. Carries the kind, because whether to interrupt somebody may
   * depend on it, and carries nothing about the Moment: what it says and who
   * else has responded are read by whoever needs them, from state that still
   * knows who may see them.
   *
   * @param tx - The caller's transaction.
   * @param momentId - What was responded to.
   * @param authorUserId - Whose it is.
   * @param actorUserId - Who responded.
   * @param kind - How.
   * @returns Nothing.
   */
  private async announce(
    tx: Transaction,
    momentId: string,
    authorUserId: string,
    actorUserId: string,
    kind: string,
  ): Promise<void> {
    const at = this.clock();
    const traceId = randomUUID();

    await enqueueOutboxMessage(tx, {
      topic: topicName(REACTIONS_BOUNDARY),
      // Ordered per Moment, so two responses to one thing are handled in the
      // order they were given.
      partitionKey: momentId,
      aggregateType: "moment",
      aggregateId: momentId,
      aggregateVersion: 0,
      eventType: "MomentReacted",
      eventVersion: 1,
      payload: { momentId, authorUserId, actorUserId, kind, reactedAt: at.toISOString() },
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

  /**
   * Whether a Block separates two people, whichever of them set it.
   *
   * @param oneUserId - One of them.
   * @param otherUserId - The other.
   * @returns Whether either has blocked the other. Both directions, matching
   *   how a Block already governs what each may see of the other.
   */
  private async isBlocked(oneUserId: string, otherUserId: string): Promise<boolean> {
    if (oneUserId === otherUserId) {
      return false;
    }

    const blocks = await this.follows.blocksBetween(oneUserId, otherUserId);

    return blocks.iBlockedThem || blocks.theyBlockedMe;
  }
}
