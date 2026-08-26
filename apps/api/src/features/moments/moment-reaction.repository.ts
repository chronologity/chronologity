import type { ReactionKind, ReactionSummary } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { MomentReaction } from "./moment-reaction.model.js";
import { Moment as MomentRow } from "./moment.model.js";

/** Reads and writes reactions to Moments. */
export class MomentReactionRepository {
  /**
   * Build the reaction repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction of their own.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Leave or change somebody's reaction.
   *
   * An upsert on the pair, which is what makes replacement the natural
   * operation: `reactions.md:137` says selecting a second kind replaces the
   * first rather than adding to it, and the primary key means the database
   * enforces that rather than the application remembering to.
   *
   * @param tx - The caller's transaction.
   * @param momentId - What is being reacted to.
   * @param userId - Who is reacting.
   * @param kind - Which of the four.
   * @param at - When.
   * @returns Nothing.
   */
  async set(
    tx: Transaction,
    momentId: string,
    userId: string,
    kind: ReactionKind,
    at: Date,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(MomentReaction)
      .values({ momentId, userId, kind, createdAt: at, updatedAt: at })
      .orUpdate(["kind", "updated_at"], ["moment_id", "user_id"])
      .execute();
  }

  /**
   * Take somebody's reaction back.
   *
   * @param tx - The caller's transaction.
   * @param momentId - What they reacted to.
   * @param userId - Who is withdrawing.
   * @returns Nothing. Withdrawing one that was never left is the state the
   *   caller asked for, not an error.
   */
  async remove(tx: Transaction, momentId: string, userId: string): Promise<void> {
    await tx.delete(MomentReaction, { momentId, userId });
  }

  /**
   * Remove everything two people left on each other's Moments.
   *
   * Called inside the transaction that records a Block. `reactions.md:364`
   * permits a Block to invalidate a Reaction, and severing matches what a Block
   * already does to follows and requests.
   *
   * Doing it once, here, also keeps the cost bounded by what those two people
   * actually did — the alternative is joining against `user_blocks` on every
   * count query for the rest of the system's life.
   *
   * @param tx - The caller's transaction.
   * @param oneUserId - One of them.
   * @param otherUserId - The other.
   * @returns Nothing.
   */
  async severBetween(tx: Transaction, oneUserId: string, otherUserId: string): Promise<void> {
    await tx
      .createQueryBuilder()
      .delete()
      .from(MomentReaction)
      .where(
        `(user_id = :oneUserId AND moment_id IN (
            SELECT moment_id FROM moments WHERE author_user_id = :otherUserId
          ))
         OR (user_id = :otherUserId AND moment_id IN (
            SELECT moment_id FROM moments WHERE author_user_id = :oneUserId
          ))`,
        { oneUserId, otherUserId },
      )
      .execute();
  }

  /**
   * Count how a Moment has been responded to.
   *
   * Aggregated rather than read from a running total. A counter column on
   * `moments` would be the contended row the roadmap forbids — every reaction
   * on a popular Moment queueing behind one lock — and `reactions.md:214`
   * already permits counts to be derived and eventually consistent, which is
   * the door a projection walks through later.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who is asking, so their own can be reported back.
   * @param enabled - Whether the Moment accepts reactions. When it does not,
   *   the counts are withheld rather than computed: disabling hides what is
   *   there, and computing it only to discard it would be wasted work.
   * @returns The summary. A kind nobody chose is absent rather than zero.
   */
  async summarise(
    momentId: string,
    viewerUserId: string,
    enabled: boolean,
  ): Promise<ReactionSummary> {
    if (!enabled) {
      return { enabled: false, counts: {}, total: 0, yours: null };
    }

    const rows: { kind: string; count: string }[] = await this.dataSource
      .getRepository(MomentReaction)
      .createQueryBuilder("reaction")
      .select("reaction.kind", "kind")
      .addSelect("COUNT(*)", "count")
      .where("reaction.moment_id = :momentId", { momentId })
      // A suspended account stops counting. Hiding what somebody contributed
      // while still tallying it would leave their reach intact — and
      // significance scoring reads these numbers, so the account would go on
      // amplifying content it can no longer see. Nothing is deleted: the rows
      // stay, and reinstatement restores the totals exactly.
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM users reactor
            WHERE reactor.user_id = reaction.user_id
              AND reactor.status = 'suspended'
         )`,
      )
      .groupBy("reaction.kind")
      .getRawMany();

    const counts: Partial<Record<ReactionKind, number>> = {};
    let total = 0;

    for (const row of rows) {
      const count = Number(row.count);

      counts[row.kind as ReactionKind] = count;
      // Each person holds at most one, so summing the kinds is the number of
      // people. `reactions.md:216` requires exactly that: historical changes
      // must not inflate the current total.
      total += count;
    }

    const mine = await this.dataSource
      .getRepository(MomentReaction)
      .findOne({ where: { momentId, userId: viewerUserId }, select: { kind: true } });

    return { enabled: true, counts, total, yours: (mine?.kind as ReactionKind) ?? null };
  }

  /**
   * Turn reactions on or off for a Moment.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param enabled - Whether to accept them.
   * @param at - When.
   * @returns Nothing. Nothing is deleted either way, so re-enabling brings the
   *   same counts back.
   */
  async setEnabled(
    tx: Transaction,
    momentId: string,
    enabled: boolean,
    at: Date,
  ): Promise<void> {
    await tx.update(MomentRow, { momentId }, { reactionsEnabled: enabled, updatedAt: at });
  }
}
