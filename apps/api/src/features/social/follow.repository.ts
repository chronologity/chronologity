import type { Cursor } from "../../lib/pagination/cursor.js";
import { randomUUID } from "node:crypto";
import type {
  Location as LocationContract,
  PublicUser,
  RealWorldEvent as RealWorldEventContract,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import type { Location } from "../locations/location.model.js";
import { toLocation } from "../locations/location.repository.js";
import type { RealWorldEvent } from "../real-world-events/real-world-event.model.js";
import { toRealWorldEvent } from "../real-world-events/real-world-event.repository.js";
import { User } from "../users/user.model.js";
import { toPublicUser } from "../users/user.repository.js";
import { UserBlock } from "./block.model.js";
import {
  FollowRequest,
  LocationFollow,
  RealWorldEventFollow,
  UserFollow,
} from "./follow.model.js";

/**
 * Where following is stored.
 *
 * Reads take the DataSource and writes take a transaction. Accepting a request
 * is two writes — the Follow appears and the request resolves — and a request
 * accepted without the Follow existing would be a person told yes by somebody
 * who is not, in fact, followed by them.
 */

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
   * @param after - Where to continue from, or undefined to start.
   * @returns The people, most recent relationship first, each with the moment
   *   and identifier a cursor needs to continue past them.
   */
  async listPeople(
    userId: string,
    direction: "following" | "followers",
    limit: number,
    after?: Cursor,
  ): Promise<{ user: PublicUser; createdAt: Date; otherUserId: string }[]> {
    const mine = direction === "following" ? "follower_user_id" : "followed_user_id";
    const theirs = direction === "following" ? "followed_user_id" : "follower_user_id";

    const query = this.dataSource
      .getRepository(UserFollow)
      .createQueryBuilder("follow")
      .innerJoinAndMapOne("follow.other", User, "other", `other.user_id = follow.${theirs}`)
      .where(`follow.${mine} = :userId`, { userId })
      .orderBy("follow.created_at", "DESC")
      .take(limit);

    if (after !== undefined) {
      // Compared as a tuple, so a row sharing its moment with the last of the
      // previous page is neither repeated nor skipped. A cursor over the
      // timestamp alone cannot do this, and two follows made in quick
      // succession share one readily.
      query.andWhere(`(follow.created_at, follow.${theirs}) < (:at, :otherId)`, {
        at: after.at,
        otherId: after.id,
      });
    }

    const rows = (await query
      .addOrderBy(`follow.${theirs}`, "DESC")
      .getMany()) as (UserFollow & { other: User })[];

    return rows.map((row) => ({
      user: toPublicUser(row.other),
      createdAt: row.createdAt,
      otherUserId: direction === "following" ? row.followedUserId : row.followerUserId,
    }));
  }

  /**
   * Record that somebody follows a real-world Event.
   *
   * @param tx - The caller's transaction.
   * @param followerUserId - Who is following.
   * @param realWorldEventId - Which occurrence.
   * @param at - When.
   * @returns Nothing. Following something already followed is the same
   *   relationship asserted twice, so a repeat is ignored.
   */
  async followEvent(
    tx: Transaction,
    followerUserId: string,
    realWorldEventId: string,
    at: Date,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(RealWorldEventFollow)
      .values({ followerUserId, realWorldEventId, createdAt: at })
      .orIgnore()
      .execute();
  }

  /**
   * Stop following a real-world Event.
   *
   * @param tx - The caller's transaction.
   * @param followerUserId - Who was following.
   * @param realWorldEventId - Which occurrence.
   * @returns Nothing.
   */
  async unfollowEvent(
    tx: Transaction,
    followerUserId: string,
    realWorldEventId: string,
  ): Promise<void> {
    await tx.delete(RealWorldEventFollow, { followerUserId, realWorldEventId });
  }

  /**
   * Record that somebody follows a Location.
   *
   * @param tx - The caller's transaction.
   * @param followerUserId - Who is following.
   * @param locationId - Which place.
   * @param at - When.
   * @returns Nothing.
   */
  async followLocation(
    tx: Transaction,
    followerUserId: string,
    locationId: string,
    at: Date,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(LocationFollow)
      .values({ followerUserId, locationId, createdAt: at })
      .orIgnore()
      .execute();
  }

  /**
   * Stop following a Location.
   *
   * @param tx - The caller's transaction.
   * @param followerUserId - Who was following.
   * @param locationId - Which place.
   * @returns Nothing.
   */
  async unfollowLocation(
    tx: Transaction,
    followerUserId: string,
    locationId: string,
  ): Promise<void> {
    await tx.delete(LocationFollow, { followerUserId, locationId });
  }

  /**
   * Read a page of the occurrences somebody follows.
   *
   * @param followerUserId - Whose list.
   * @param limit - How many at most.
   * @param after - Where to continue from.
   * @returns The Events whole, newest relationship first, each with what the
   *   cursor needs to continue.
   */
  async listFollowedEvents(
    followerUserId: string,
    limit: number,
    after?: Cursor,
  ): Promise<{ event: RealWorldEventContract; createdAt: Date; otherId: string }[]> {
    const query = this.dataSource
      .getRepository(RealWorldEventFollow)
      .createQueryBuilder("follow")
      .innerJoinAndSelect("follow.realWorldEvent", "event")
      .leftJoinAndSelect("event.aliases", "alias")
      .leftJoinAndSelect("event.locations", "place")
      .where("follow.follower_user_id = :followerUserId", { followerUserId })
      .orderBy("follow.created_at", "DESC")
      .addOrderBy("follow.real_world_event_id", "DESC")
      .take(limit);

    if (after !== undefined) {
      query.andWhere(
        "(follow.created_at, follow.real_world_event_id) < (:at, :otherId)",
        { at: after.at, otherId: after.id },
      );
    }

    const rows = await query.getMany();

    return rows
      .filter((row): row is RealWorldEventFollow & { realWorldEvent: RealWorldEvent } =>
        row.realWorldEvent !== undefined,
      )
      .map((row) => ({
        event: toRealWorldEvent(row.realWorldEvent),
        createdAt: row.createdAt,
        otherId: row.realWorldEventId,
      }));
  }

  /**
   * Read a page of the people following a place or an occasion.
   *
   * The reverse of `listFollowedEvents` and `listFollowedLocations`, which until
   * now was the only direction this table could be read in — so following a
   * Location was recorded and consumed by nothing.
   *
   * **Paged, not gathered.** A well-known place could be followed by everybody,
   * and a fan-out that read the whole list into memory to notify it would hold
   * that list for as long as the notifying took. The caller walks instead.
   *
   * Identifiers only. The caller wants somebody to notify, not a profile to
   * render, and reading whole accounts here would fetch a great deal that is
   * then thrown away.
   *
   * @param context - Which place or occasion.
   * @param limit - How many at most.
   * @param after - Resume after this follower, so a walk is resumable and does
   *   not depend on the set staying still.
   * @returns Their identifiers, oldest relationship first — a stable order that
   *   a new follower cannot insert into the middle of.
   * @throws {Error} If the database refuses.
   */
  async followersOf(
    context: { type: "location"; id: string } | { type: "real_world_event"; id: string },
    limit: number,
    after?: string,
  ): Promise<string[]> {
    const [table, column] =
      context.type === "location"
        ? ["location_follows", "location_id"]
        : ["real_world_event_follows", "real_world_event_id"];

    const rows: { follower_user_id: string }[] = await this.dataSource.query(
      `SELECT follower_user_id FROM ${table}
        WHERE ${column} = $1
          AND ($2::uuid IS NULL OR follower_user_id > $2::uuid)
        ORDER BY follower_user_id ASC
        LIMIT $3`,
      [context.id, after ?? null, limit],
    );

    return rows.map((row) => row.follower_user_id);
  }

  /**
   * Read a page of the places somebody follows.
   *
   * @param followerUserId - Whose list.
   * @param limit - How many at most.
   * @param after - Where to continue from.
   * @returns The places whole, newest relationship first.
   */
  async listFollowedLocations(
    followerUserId: string,
    limit: number,
    after?: Cursor,
  ): Promise<{ location: LocationContract; createdAt: Date; otherId: string }[]> {
    const query = this.dataSource
      .getRepository(LocationFollow)
      .createQueryBuilder("follow")
      .innerJoinAndSelect("follow.location", "place")
      .where("follow.follower_user_id = :followerUserId", { followerUserId })
      .orderBy("follow.created_at", "DESC")
      .addOrderBy("follow.location_id", "DESC")
      .take(limit);

    if (after !== undefined) {
      query.andWhere("(follow.created_at, follow.location_id) < (:at, :otherId)", {
        at: after.at,
        otherId: after.id,
      });
    }

    const rows = await query.getMany();

    return rows
      .filter((row): row is LocationFollow & { location: Location } => row.location !== undefined)
      .map((row) => ({
        location: toLocation(row.location),
        createdAt: row.createdAt,
        otherId: row.locationId,
      }));
  }

  /**
   * Read a page of the requests waiting on somebody.
   *
   * @param requestedUserId - Who was asked.
   * @param limit - How many at most.
   * @param after - Where to continue from, or undefined to start.
   * @returns The pending requests, most recent first, each with who asked.
   *   Resolved ones are omitted: somebody reviewing what is waiting on them
   *   wants what is open now.
   */
  async listPendingRequests(
    requestedUserId: string,
    limit: number,
    after?: Cursor,
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
      .addOrderBy("request.request_id", "DESC")
      .take(limit);

    if (after !== undefined) {
      query.andWhere("(request.requested_at, request.request_id) < (:at, :otherId)", {
        at: after.at,
        otherId: after.id,
      });
    }

    const rows = (await query.getMany()) as (FollowRequest & { asker: User })[];

    return rows.map((row) => ({ request: row, requester: toPublicUser(row.asker) }));
  }

  /**
   * Which way a block runs between two people, if either way does.
   *
   * @param userId - The person acting.
   * @param otherUserId - The person they are acting on.
   * @returns Both directions, because they mean different things: being blocked
   *   is reported as the other account not existing, while having blocked is
   *   said plainly.
   */
  async blocksBetween(
    userId: string,
    otherUserId: string,
  ): Promise<{ theyBlockedMe: boolean; iBlockedThem: boolean }> {
    const rows = await this.dataSource.getRepository(UserBlock).find({
      where: [
        { blockerUserId: otherUserId, blockedUserId: userId },
        { blockerUserId: userId, blockedUserId: otherUserId },
      ],
      select: { blockerUserId: true, blockedUserId: true },
    });

    return {
      theyBlockedMe: rows.some((row) => row.blockerUserId === otherUserId),
      iBlockedThem: rows.some((row) => row.blockerUserId === userId),
    };
  }

  /**
   * Record a block.
   *
   * @param tx - The caller's transaction.
   * @param blockerUserId - Who is blocking.
   * @param blockedUserId - Who is being blocked.
   * @param at - When.
   * @returns Nothing. Blocking somebody already blocked is the state already
   *   holding, so a repeat is ignored rather than refused.
   */
  async block(
    tx: Transaction,
    blockerUserId: string,
    blockedUserId: string,
    at: Date,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(UserBlock)
      .values({ blockerUserId, blockedUserId, createdAt: at })
      .orIgnore()
      .execute();
  }

  /**
   * Remove a block.
   *
   * @param tx - The caller's transaction.
   * @param blockerUserId - Who blocked.
   * @param blockedUserId - Who was blocked.
   * @returns Nothing. What the block severed stays severed: unblocking removes
   *   the boundary and restores no relationship (`social-graph.md:315`).
   */
  async unblock(
    tx: Transaction,
    blockerUserId: string,
    blockedUserId: string,
  ): Promise<void> {
    await tx.delete(UserBlock, { blockerUserId, blockedUserId });
  }

  /**
   * Settle any pending request between two people, whichever way it runs.
   *
   * @param tx - The caller's transaction.
   * @param userId - One of them.
   * @param otherUserId - The other.
   * @param at - When.
   * @returns Nothing. Recorded as cancelled rather than declined: a block is
   *   not an answer to the question the request asked, and calling it one would
   *   put a refusal in the record that nobody actually gave.
   */
  async cancelRequestsBetween(
    tx: Transaction,
    userId: string,
    otherUserId: string,
    at: Date,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .update(FollowRequest)
      .set({ status: "cancelled", resolvedAt: at })
      .where("status = 'pending'")
      .andWhere(
        `((requester_user_id = :userId AND requested_user_id = :otherUserId)
          OR (requester_user_id = :otherUserId AND requested_user_id = :userId))`,
        { userId, otherUserId },
      )
      .execute();
  }

  /**
   * Read a page of the people somebody has blocked.
   *
   * @param blockerUserId - Whose list. Always the caller.
   * @param limit - How many at most.
   * @param after - Where to continue from.
   * @returns The people, most recently blocked first.
   */
  async listBlocked(
    blockerUserId: string,
    limit: number,
    after?: Cursor,
  ): Promise<{ user: PublicUser; createdAt: Date; otherUserId: string }[]> {
    const query = this.dataSource
      .getRepository(UserBlock)
      .createQueryBuilder("block")
      .innerJoinAndMapOne(
        "block.other",
        User,
        "other",
        "other.user_id = block.blocked_user_id",
      )
      .where("block.blocker_user_id = :blockerUserId", { blockerUserId })
      .orderBy("block.created_at", "DESC")
      .addOrderBy("block.blocked_user_id", "DESC")
      .take(limit);

    if (after !== undefined) {
      query.andWhere("(block.created_at, block.blocked_user_id) < (:at, :otherId)", {
        at: after.at,
        otherId: after.id,
      });
    }

    const rows = (await query.getMany()) as (UserBlock & { other: User })[];

    return rows.map((row) => ({
      user: toPublicUser(row.other),
      createdAt: row.createdAt,
      otherUserId: row.blockedUserId,
    }));
  }
}
