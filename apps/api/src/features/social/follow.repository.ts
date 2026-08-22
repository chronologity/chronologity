import { randomUUID } from "node:crypto";
import type { PublicUser } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { User } from "../users/user.model.js";
import { FollowRequest, UserFollow } from "./follow.model.js";

/**
 * Where following is stored.
 *
 * Reads take the DataSource and writes take a transaction. Accepting a request
 * is two writes — the Follow appears and the request resolves — and a request
 * accepted without the Follow existing would be a person told yes by somebody
 * who is not, in fact, followed by them.
 */

/**
 * Shape a stored account as the public view.
 *
 * @param row - As read from `users`.
 * @returns What anybody may see. Follower lists carry no more than this: who
 *   may see whose followers is four separate open questions, so nothing here
 *   discloses more than a profile already does.
 */
function toPublicUser(row: User): PublicUser {
  return {
    userId: row.userId,
    handle: row.handle,
    displayName: row.displayName,
    biography: row.biography,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Reads and writes following. */
export class FollowRepository {
  /**
   * Build the follow repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction of their own.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Whether one person already follows another.
   *
   * @param followerUserId - Who is following.
   * @param followedUserId - Who they would be following.
   * @returns True if the relationship already exists.
   */
  async exists(followerUserId: string, followedUserId: string): Promise<boolean> {
    return this.dataSource
      .getRepository(UserFollow)
      .existsBy({ followerUserId, followedUserId });
  }

  /**
   * Whether an account has to approve who follows it.
   *
   * @param userId - Whose account.
   * @returns True when approval is required. False for an account with no
   *   preferences row, which cannot happen for a created account but is the
   *   safer answer to give than throwing: an open account is what the default
   *   describes.
   */
  async requiresApproval(userId: string): Promise<boolean> {
    const rows: { requires_follow_approval: boolean }[] = await this.dataSource.query(
      `SELECT requires_follow_approval FROM user_preferences WHERE user_id = $1`,
      [userId],
    );

    return rows[0]?.requires_follow_approval ?? false;
  }

  /**
   * Record that one person follows another.
   *
   * @param tx - The caller's transaction.
   * @param followerUserId - Who is following.
   * @param followedUserId - Who they now follow.
   * @param at - When.
   * @returns Nothing. Following somebody already followed is the same
   *   relationship asserted twice, so a repeat is ignored rather than refused.
   */
  async follow(
    tx: Transaction,
    followerUserId: string,
    followedUserId: string,
    at: Date,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(UserFollow)
      .values({ followerUserId, followedUserId, createdAt: at })
      .orIgnore()
      .execute();
  }

  /**
   * End a following relationship.
   *
   * @param tx - The caller's transaction.
   * @param followerUserId - Who was following.
   * @param followedUserId - Who they were following.
   * @returns True if there was one to end. The row is removed rather than
   *   marked: the product has not asked to keep a record that somebody once
   *   followed somebody else, and keeping one would invite a query that forgets
   *   to exclude it.
   */
  async unfollow(
    tx: Transaction,
    followerUserId: string,
    followedUserId: string,
  ): Promise<boolean> {
    const { affected } = await tx.delete(UserFollow, { followerUserId, followedUserId });

    return affected === 1;
  }

  /**
   * Open a request to follow somebody.
   *
   * @param tx - The caller's transaction.
   * @param requesterUserId - Who is asking.
   * @param requestedUserId - Who is being asked.
   * @param at - When.
   * @returns The new request's identifier, or undefined when one is already
   *   open. The partial unique index decides that rather than a read before
   *   the write, so two simultaneous asks cannot both succeed.
   */
  async openRequest(
    tx: Transaction,
    requesterUserId: string,
    requestedUserId: string,
    at: Date,
  ): Promise<string | undefined> {
    const requestId = randomUUID();

    const opened = await tx
      .createQueryBuilder()
      .insert()
      .into(FollowRequest)
      .values({
        requestId,
        requesterUserId,
        requestedUserId,
        status: "pending",
        requestedAt: at,
        resolvedAt: null,
      })
      .orIgnore()
      .returning(["requestId"])
      .execute();

    return (opened.raw as unknown[]).length === 1 ? requestId : undefined;
  }

  /**
   * Read one request.
   *
   * @param requestId - Which request.
   * @returns It as stored, or undefined. Returned whatever its status, because
   *   the caller has to tell "already answered" from "never existed".
   */
  async findRequest(requestId: string): Promise<FollowRequest | undefined> {
    const row = await this.dataSource.getRepository(FollowRequest).findOneBy({ requestId });

    return row ?? undefined;
  }

  /**
   * Read the pending request between two people, if there is one.
   *
   * @param requesterUserId - Who asked.
   * @param requestedUserId - Who was asked.
   * @returns The open request, or undefined.
   */
  async findPendingRequest(
    requesterUserId: string,
    requestedUserId: string,
  ): Promise<FollowRequest | undefined> {
    const row = await this.dataSource
      .getRepository(FollowRequest)
      .findOneBy({ requesterUserId, requestedUserId, status: "pending" });

    return row ?? undefined;
  }

  /**
   * Settle a request one way or another.
   *
   * @param tx - The caller's transaction.
   * @param requestId - Which request.
   * @param status - How it ended.
   * @param at - When.
   * @returns True if this call settled it. The current status is part of the
   *   condition rather than something read first, so two people answering at
   *   once cannot both believe they were the one who did.
   */
  async resolveRequest(
    tx: Transaction,
    requestId: string,
    status: "accepted" | "declined" | "cancelled",
    at: Date,
  ): Promise<boolean> {
    const { affected } = await tx.update(
      FollowRequest,
      { requestId, status: "pending" },
      { status, resolvedAt: at },
    );

    return affected === 1;
  }

  /**
   * Read a page of the people somebody follows, or who follow them.
   *
   * @param userId - Whose relationships.
   * @param direction - `following` for people they follow, `followers` for
   *   people who follow them.
   * @param limit - How many at most.
   * @param before - Continue from before this moment, or undefined to start.
   * @returns The people, most recent relationship first, each with the moment
   *   the relationship began so a caller can continue from it.
   */
  async listPeople(
    userId: string,
    direction: "following" | "followers",
    limit: number,
    before?: Date,
  ): Promise<{ user: PublicUser; createdAt: Date }[]> {
    const mine = direction === "following" ? "follower_user_id" : "followed_user_id";
    const theirs = direction === "following" ? "followed_user_id" : "follower_user_id";

    const query = this.dataSource
      .getRepository(UserFollow)
      .createQueryBuilder("follow")
      .innerJoinAndMapOne("follow.other", User, "other", `other.user_id = follow.${theirs}`)
      .where(`follow.${mine} = :userId`, { userId })
      .orderBy("follow.created_at", "DESC")
      .take(limit);

    if (before !== undefined) {
      query.andWhere("follow.created_at < :before", { before });
    }

    const rows = (await query.getMany()) as (UserFollow & { other: User })[];

    return rows.map((row) => ({ user: toPublicUser(row.other), createdAt: row.createdAt }));
  }

  /**
   * Read a page of the requests waiting on somebody.
   *
   * @param requestedUserId - Who was asked.
   * @param limit - How many at most.
   * @param before - Continue from before this moment, or undefined to start.
   * @returns The pending requests, most recent first, each with who asked.
   *   Resolved ones are omitted: somebody reviewing what is waiting on them
   *   wants what is open now.
   */
  async listPendingRequests(
    requestedUserId: string,
    limit: number,
    before?: Date,
  ): Promise<{ request: FollowRequest; requester: PublicUser }[]> {
    const query = this.dataSource
      .getRepository(FollowRequest)
      .createQueryBuilder("request")
      .innerJoinAndMapOne(
        "request.asker",
        User,
        "asker",
        "asker.user_id = request.requester_user_id",
      )
      .where("request.requested_user_id = :requestedUserId", { requestedUserId })
      .andWhere("request.status = 'pending'")
      .orderBy("request.requested_at", "DESC")
      .take(limit);

    if (before !== undefined) {
      query.andWhere("request.requested_at < :before", { before });
    }

    const rows = (await query.getMany()) as (FollowRequest & { asker: User })[];

    return rows.map((row) => ({ request: row, requester: toPublicUser(row.asker) }));
  }
}
