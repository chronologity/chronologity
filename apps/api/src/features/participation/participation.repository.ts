import { randomUUID } from "node:crypto";
import type { PublicUser } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import type { Cursor } from "../../lib/pagination/cursor.js";
import type { Transaction } from "../../lib/database/transaction.js";
import { Moment } from "../moments/moment.model.js";
import { User } from "../users/user.model.js";
import { toPublicUser } from "../users/user.repository.js";
import { MomentParticipation, ParticipationRefusal } from "./participation.model.js";

/**
 * Reading and writing participations.
 *
 * Reads take the DataSource and writes take a transaction, as everywhere here:
 * a repository that could write outside its caller's transaction is a repository
 * that will eventually do so.
 *
 * Every state change is a conditional update with the current status in the
 * `WHERE`, never a read followed by a write. Two people answering the same
 * proposal at once must produce one answer and one refusal rather than a race
 * decided by whichever read landed first.
 */

/** A participation and the two people it concerns. */
export interface ParticipationView {
  readonly participation: MomentParticipation;
  /** Who is said to have been there. */
  readonly named: PublicUser;
  /** The Moment's author, who is by definition who proposed. */
  readonly proposedBy: PublicUser;
}

/**
 * Reading and writing participations and the refusals that govern them.
 */
export class ParticipationRepository {
  /**
   * Build the repository.
   *
   * @param dataSource - Reads use this directly; writes take a transaction.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Propose that somebody was part of a Moment.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param userId - Who is said to have been there.
   * @param at - When the proposal was made.
   * @returns The new participation's identifier, or undefined when the pair
   *   already has a row — which is how a rejected or withdrawn participation
   *   refuses a second proposal. The unique constraint decides that rather than
   *   a read taken before the write, so two proposals racing produce one row.
   * @throws {Error} If the database refuses for any other reason.
   */
  async propose(
    tx: Transaction,
    momentId: string,
    userId: string,
    at: Date,
  ): Promise<string | undefined> {
    const participationId = randomUUID();

    const proposed = await tx
      .createQueryBuilder()
      .insert()
      .into(MomentParticipation)
      .values({
        participationId,
        momentId,
        userId,
        status: "proposed",
        proposedAt: at,
        resolvedAt: null,
      })
      .orIgnore()
      .returning(["participationId"])
      .execute();

    return (proposed.raw as unknown[]).length === 1 ? participationId : undefined;
  }

  /**
   * Read one participation, with the people it concerns.
   *
   * @param participationId - Which participation.
   * @returns It, or undefined when there is no such row. The author comes from
   *   the Moment rather than from a column, which is what makes "only the
   *   creator proposes" unable to drift.
   */
  async find(participationId: string): Promise<ParticipationView | undefined> {
    const row = (await this.dataSource
      .getRepository(MomentParticipation)
      .createQueryBuilder("participation")
      .innerJoinAndMapOne("participation.named", User, "named", "named.user_id = participation.user_id")
      .innerJoinAndMapOne(
        "participation.moment",
        Moment,
        "moment",
        "moment.moment_id = participation.moment_id",
      )
      .innerJoinAndMapOne("participation.author", User, "author", "author.user_id = moment.author_user_id")
      .where("participation.participation_id = :participationId", { participationId })
      .getOne()) as (MomentParticipation & { named: User; author: User; moment: Moment }) | null;

    if (row === null) {
      return undefined;
    }

    return {
      participation: row,
      named: toPublicUser(row.named),
      proposedBy: toPublicUser(row.author),
    };
  }

  /**
   * Answer a proposal.
   *
   * @param tx - The caller's transaction.
   * @param participationId - Which participation.
   * @param status - What it became.
   * @param at - When it was answered.
   * @returns Whether this call was the one that answered it. False means
   *   somebody else got there first, which is a refusal rather than an error.
   * @throws {Error} If the database refuses.
   */
  async answer(
    tx: Transaction,
    participationId: string,
    status: "accepted" | "rejected",
    at: Date,
  ): Promise<boolean> {
    const { affected } = await tx.update(
      MomentParticipation,
      // The current status is part of the match, so an answer already given
      // cannot be overwritten by one arriving a moment later.
      { participationId, status: "proposed" },
      { status, resolvedAt: at },
    );

    return affected === 1;
  }

  /**
   * Take back a participation that was accepted.
   *
   * The row stays, which is the point: `withdrawn` is what refuses the next
   * proposal for this pair.
   *
   * @param tx - The caller's transaction.
   * @param participationId - Which participation.
   * @param at - When it was withdrawn.
   * @returns Whether this call withdrew it.
   * @throws {Error} If the database refuses.
   */
  async withdraw(tx: Transaction, participationId: string, at: Date): Promise<boolean> {
    const { affected } = await tx.update(
      MomentParticipation,
      { participationId, status: "accepted" },
      { status: "withdrawn", resolvedAt: at },
    );

    return affected === 1;
  }

  /**
   * Take back a proposal nobody answered.
   *
   * Deletes rather than marking, and that is the whole difference from a
   * withdrawal. A retracted question is not a refusal, so it must not spend the
   * one chance the creator has — and under a unique constraint on the pair,
   * leaving any row behind would spend it. It also satisfies invariant 8:
   * nothing remains to say the question was asked.
   *
   * @param tx - The caller's transaction.
   * @param participationId - Which participation.
   * @returns Whether a proposal was cancelled. False means it had been answered
   *   in the meantime, which the caller reports rather than overrides.
   * @throws {Error} If the database refuses.
   */
  async cancel(tx: Transaction, participationId: string): Promise<boolean> {
    const { affected } = await tx.delete(MomentParticipation, {
      participationId,
      status: "proposed",
    });

    return affected === 1;
  }

  /**
   * How many people a Moment already names.
   *
   * Proposals as well as acceptances, so a pending proposal holds its place —
   * otherwise a hundred could accept out of a hundred and fifty asked.
   *
   * @param momentId - Which Moment.
   * @returns The count.
   * @throws {Error} If the database refuses.
   */
  async countLive(momentId: string): Promise<number> {
    return this.dataSource.getRepository(MomentParticipation).count({
      where: [
        { momentId, status: "proposed" },
        { momentId, status: "accepted" },
      ],
    });
  }

  /**
   * Who a Moment records as having been there.
   *
   * Accepted only. A proposal is visible to the two people in it and to nobody
   * else, so it must never be reachable from the Moment.
   *
   * @param momentId - Which Moment.
   * @param limit - How many at most.
   * @returns The participants, most recently proposed first.
   * @throws {Error} If the database refuses.
   */
  async listAccepted(
    momentId: string,
    limit: number,
  ): Promise<{ user: PublicUser; acceptedAt: Date }[]> {
    const rows = (await this.dataSource
      .getRepository(MomentParticipation)
      .createQueryBuilder("participation")
      .innerJoinAndMapOne("participation.named", User, "named", "named.user_id = participation.user_id")
      .where("participation.moment_id = :momentId", { momentId })
      .andWhere("participation.status = 'accepted'")
      .orderBy("participation.proposed_at", "DESC")
      .addOrderBy("participation.participation_id", "DESC")
      .take(limit)
      .getMany()) as (MomentParticipation & { named: User })[];

    return rows.map((row) => ({
      user: toPublicUser(row.named),
      // Non-null by the status filter: an accepted row has a resolution, which
      // the database's own check constraint guarantees.
      acceptedAt: row.resolvedAt as Date,
    }));
  }

  /**
   * Somebody's participations, in one direction.
   *
   * @param userId - Whose.
   * @param direction - `to-me` lists what others have said about them, which
   *   they may answer. `by-me` lists what they have said about others, which
   *   they may retract.
   * @param status - Restrict to one state, or undefined for every state.
   * @param limit - How many at most.
   * @param after - Resume after this position.
   * @returns The participations, newest first.
   * @throws {Error} If the database refuses.
   */
  async list(
    userId: string,
    direction: "to-me" | "by-me",
    status: string | undefined,
    limit: number,
    after?: Cursor,
  ): Promise<ParticipationView[]> {
    const query = this.dataSource
      .getRepository(MomentParticipation)
      .createQueryBuilder("participation")
      .innerJoinAndMapOne("participation.named", User, "named", "named.user_id = participation.user_id")
      .innerJoinAndMapOne(
        "participation.moment",
        Moment,
        "moment",
        "moment.moment_id = participation.moment_id",
      )
      .innerJoinAndMapOne(
        "participation.author",
        User,
        "author",
        "author.user_id = moment.author_user_id",
      )
      .orderBy("participation.proposed_at", "DESC")
      .addOrderBy("participation.participation_id", "DESC")
      .take(limit);

    if (direction === "to-me") {
      query.where("participation.user_id = :userId", { userId });
    } else {
      // Whose Moment it is, read through the Moment rather than from a column
      // here — the same join that makes the proposer unable to disagree with
      // the author.
      query.where("moment.author_user_id = :userId", { userId });
    }

    if (status !== undefined) {
      query.andWhere("participation.status = :status", { status });
    }

    if (after !== undefined) {
      query.andWhere("(participation.proposed_at, participation.participation_id) < (:at, :id)", {
        at: after.at,
        id: after.id,
      });
    }

    const rows = (await query.getMany()) as (MomentParticipation & {
      named: User;
      author: User;
    })[];

    return rows.map((row) => ({
      participation: row,
      named: toPublicUser(row.named),
      proposedBy: toPublicUser(row.author),
    }));
  }

  /**
   * Whether somebody has refused proposals from another person.
   *
   * One direction only. Nothing may ask who has refused *them*: a refusal
   * exists so somebody can stop being asked, and telling the asker hands them
   * what they need to ask another way.
   *
   * @param refusingUserId - Who may have refused.
   * @param refusedUserId - Who they may have refused.
   * @returns Whether the refusal exists.
   * @throws {Error} If the database refuses.
   */
  async hasRefused(refusingUserId: string, refusedUserId: string): Promise<boolean> {
    return (
      (await this.dataSource
        .getRepository(ParticipationRefusal)
        .countBy({ refusingUserId, refusedUserId })) > 0
    );
  }

  /**
   * Refuse proposals from somebody.
   *
   * Idempotent: refusing twice is the same state as refusing once, and the
   * second call asserting an error would make a retry a failure.
   *
   * @param tx - The caller's transaction.
   * @param refusingUserId - Who is refusing.
   * @param refusedUserId - Who they are refusing.
   * @param at - When.
   * @returns Nothing.
   * @throws {Error} If the database refuses.
   */
  async refuse(
    tx: Transaction,
    refusingUserId: string,
    refusedUserId: string,
    at: Date,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(ParticipationRefusal)
      .values({ refusingUserId, refusedUserId, createdAt: at })
      .orIgnore()
      .execute();
  }

  /**
   * Stop refusing somebody.
   *
   * Restores nothing. Proposals settled while the refusal stood stay settled,
   * as a Block's severing does.
   *
   * @param tx - The caller's transaction.
   * @param refusingUserId - Who was refusing.
   * @param refusedUserId - Who they were refusing.
   * @returns Whether a refusal was lifted.
   * @throws {Error} If the database refuses.
   */
  async allow(tx: Transaction, refusingUserId: string, refusedUserId: string): Promise<boolean> {
    const { affected } = await tx.delete(ParticipationRefusal, {
      refusingUserId,
      refusedUserId,
    });

    return (affected ?? 0) > 0;
  }

  /**
   * Who somebody has refused.
   *
   * @param refusingUserId - Whose list.
   * @param limit - How many at most.
   * @param after - Resume after this position.
   * @returns The refusals, most recent first.
   * @throws {Error} If the database refuses.
   */
  async listRefusals(
    refusingUserId: string,
    limit: number,
    after?: Cursor,
  ): Promise<{ user: PublicUser; refusedAt: Date }[]> {
    const query = this.dataSource
      .getRepository(ParticipationRefusal)
      .createQueryBuilder("refusal")
      .innerJoinAndMapOne(
        "refusal.person",
        User,
        "person",
        "person.user_id = refusal.refused_user_id",
      )
      .where("refusal.refusing_user_id = :refusingUserId", { refusingUserId })
      .orderBy("refusal.created_at", "DESC")
      .addOrderBy("refusal.refused_user_id", "DESC")
      .take(limit);

    if (after !== undefined) {
      query.andWhere("(refusal.created_at, refusal.refused_user_id) < (:at, :id)", {
        at: after.at,
        id: after.id,
      });
    }

    const rows = (await query.getMany()) as (ParticipationRefusal & { person: User })[];

    return rows.map((row) => ({ user: toPublicUser(row.person), refusedAt: row.createdAt }));
  }

  /**
   * Settle every unanswered proposal between two people, in both directions.
   *
   * Called when somebody blocks another person. A block is a refusal and a
   * stronger one than a rejection, so the proposals it settles are settled
   * permanently — unblocking restores nothing, exactly as it restores no
   * severed reaction. Both directions, because a block severs both.
   *
   * @param tx - The caller's transaction.
   * @param userId - One person.
   * @param otherUserId - The other.
   * @param at - When the block was made.
   * @returns How many proposals were settled.
   * @throws {Error} If the database refuses.
   */
  async rejectBetween(
    tx: Transaction,
    userId: string,
    otherUserId: string,
    at: Date,
  ): Promise<number> {
    const result: [unknown[], number] = await tx.query(
      `UPDATE moment_participations AS p
          SET status = 'rejected', resolved_at = $3
         FROM moments AS m
        WHERE m.moment_id = p.moment_id
          AND p.status = 'proposed'
          AND (
            (p.user_id = $1 AND m.author_user_id = $2)
            OR (p.user_id = $2 AND m.author_user_id = $1)
          )`,
      [userId, otherUserId, at],
    );

    return result[1];
  }
}
