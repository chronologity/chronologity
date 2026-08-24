import { decodeCursor, encodeCursor } from "../../lib/pagination/cursor.js";
import type {
  FollowList,
  FollowOutcome,
  FollowRequest,
  FollowRequestList,
  FollowedEventList,
  FollowedLocationList,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import type { LocationRepository } from "../locations/location.repository.js";
import type { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import type { MomentReactionRepository } from "../moments/moment-reaction.repository.js";
import type { UserRepository } from "../users/user.repository.js";
import type { FollowRepository } from "./follow.repository.js";
import {
  checkFollow,
  checkRequestResolution,
  describeFollowRejection,
  describeRequestRejection,
} from "./follow.policy.js";

/**
 * Following, and asking to follow.
 *
 * Directional, and needing no reciprocity. Following somebody is a statement
 * about wanting to hear from them, not an agreement between two people
 * (`social-graph.md:56`).
 *
 * **Following grants nothing.** `social-graph.md:167` requires that a Follow
 * "must never bypass the visibility rules of individual Moments", and it does
 * not: what somebody may see is decided by each Moment's own audience, and
 * there is deliberately no visibility meaning "my followers" for a Follow to
 * unlock (ADR-108).
 */
export class FollowService {
  /**
   * Build the follow service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param follows - Where following is stored.
   * @param users - Used to check that the other account exists.
   * @param realWorldEvents - Used to check that an occurrence being followed
   *   actually exists.
   * @param locations - Used to check that a place being followed exists.
   * @param clock - Injected so tests can move time without waiting.
   * @param reactions - Optional. Blocking severs what two people left on each
   *   other's Moments, and an application built without Moments has none to
   *   sever.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly follows: FollowRepository,
    private readonly users: UserRepository,
    private readonly realWorldEvents: RealWorldEventRepository,
    private readonly locations: LocationRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly reactions?: MomentReactionRepository,
  ) {}

  /**
   * Follow somebody, or ask to.
   *
   * @param followerUserId - Who is asking.
   * @param followedUserId - Who they want to follow.
   * @returns What happened: a Follow when the account is open, a request when it
   *   requires approval. The answer says which, so nothing has to expose
   *   whether an account requires approval — asking already reveals exactly as
   *   much as the asker needs.
   * @throws {NotFoundError} If there is no such account.
   * @throws {ValidationError} If somebody tries to follow themselves.
   */
  async follow(followerUserId: string, followedUserId: string): Promise<FollowOutcome> {
    const rejection = checkFollow(
      followerUserId,
      followedUserId,
      await this.follows.blocksBetween(followerUserId, followedUserId),
    );

    if (rejection === "blocked_by_them") {
      // Reported exactly as an account that does not exist. Announcing a block
      // is forbidden; inferring one from behaviour is not.
      throw new NotFoundError(describeFollowRejection(rejection));
    }

    if (rejection !== undefined) {
      throw new ValidationError(describeFollowRejection(rejection), { field: "userId" });
    }

    const followed = await this.users.findPublic(followedUserId);

    if (followed === undefined) {
      throw new NotFoundError("No such user");
    }

    const at = this.clock();

    // Already following is the same relationship asserted twice. Reported as
    // success rather than as a conflict: the caller asked for a state that
    // already holds.
    if (await this.follows.exists(followerUserId, followedUserId)) {
      return { outcome: "following", follow: { user: followed, followedAt: at.toISOString() } };
    }

    if (!(await this.follows.requiresApproval(followedUserId))) {
      await withTransaction(this.dataSource, (tx) =>
        this.follows.follow(tx, followerUserId, followedUserId, at),
      );

      return { outcome: "following", follow: { user: followed, followedAt: at.toISOString() } };
    }

    return { outcome: "requested", request: await this.ask(followerUserId, followedUserId, at) };
  }

  /**
   * Open a request, or hand back the one already open.
   *
   * @param requesterUserId - Who is asking.
   * @param requestedUserId - Who is being asked.
   * @param at - When.
   * @returns The request. Asking twice does not open a second: the partial
   *   unique index refuses it, and the existing one is returned instead, so a
   *   caller who taps twice sees one request rather than an error.
   * @throws {Error} If a request neither opened nor was found, which would mean
   *   it vanished between the two.
   */
  private async ask(
    requesterUserId: string,
    requestedUserId: string,
    at: Date,
  ): Promise<FollowRequest> {
    const requester = await this.users.findPublic(requesterUserId);

    if (requester === undefined) {
      throw new NotFoundError("No such user");
    }

    const opened = await withTransaction(this.dataSource, (tx) =>
      this.follows.openRequest(tx, requesterUserId, requestedUserId, at),
    );

    if (opened !== undefined) {
      return { requestId: opened, requester, status: "pending", requestedAt: at.toISOString() };
    }

    const existing = await this.follows.findPendingRequest(requesterUserId, requestedUserId);

    if (existing === undefined) {
      throw new Error("A follow request neither opened nor was found");
    }

    return {
      requestId: existing.requestId,
      requester,
      status: "pending",
      requestedAt: existing.requestedAt.toISOString(),
    };
  }

  /**
   * Stop following somebody.
   *
   * @param followerUserId - Who was following.
   * @param followedUserId - Who they were following.
   * @returns Nothing. Unfollowing somebody never followed is not an error: the
   *   caller asked for a state that already holds.
   */
  async unfollow(followerUserId: string, followedUserId: string): Promise<void> {
    await withTransaction(this.dataSource, (tx) =>
      this.follows.unfollow(tx, followerUserId, followedUserId),
    );
  }

  /**
   * Remove somebody who follows you.
   *
   * The same relationship as unfollowing, ended from the other side. Kept as
   * its own operation because they are different acts: one is losing interest,
   * the other is withdrawing an audience.
   *
   * @param followedUserId - Who is removing a follower — the caller.
   * @param followerUserId - Who is being removed.
   * @returns Nothing.
   */
  async removeFollower(followedUserId: string, followerUserId: string): Promise<void> {
    await withTransaction(this.dataSource, (tx) =>
      this.follows.unfollow(tx, followerUserId, followedUserId),
    );
  }

  /**
   * Answer a request that is waiting on you.
   *
   * @param requestId - Which request.
   * @param actorUserId - Who is answering. Only the person asked may.
   * @param decision - Whether to accept or decline.
   * @returns Nothing. Accepting creates the Follow and settles the request in
   *   one transaction: a request answered yes without the Follow existing would
   *   tell somebody they are followed by a person who is not following them.
   * @throws {NotFoundError} If there is no such request, or it is not theirs to
   *   answer. The two are indistinguishable on purpose.
   * @throws {ValidationError} If it has already been answered.
   */
  async answerRequest(
    requestId: string,
    actorUserId: string,
    decision: "accepted" | "declined",
  ): Promise<void> {
    const request = await this.requestFor(requestId, actorUserId, "requested");
    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      await this.follows.resolveRequest(tx, requestId, decision, at);

      if (decision === "accepted") {
        await this.follows.follow(tx, request.requesterUserId, request.requestedUserId, at);
      }
    });

    // Declining deliberately does nothing further. `social-graph.md:181` is
    // explicit that declining must not block, and a refusal that quietly became
    // one would be a safety mechanism nobody chose.
  }

  /**
   * Withdraw a request you made.
   *
   * @param requestId - Which request.
   * @param actorUserId - Who is withdrawing it. Only the asker may.
   * @returns Nothing.
   * @throws {NotFoundError} If there is no such request, or it is not theirs.
   * @throws {ValidationError} If it has already been answered.
   */
  async cancelRequest(requestId: string, actorUserId: string): Promise<void> {
    await this.requestFor(requestId, actorUserId, "requester");

    await withTransaction(this.dataSource, (tx) =>
      this.follows.resolveRequest(tx, requestId, "cancelled", this.clock()),
    );
  }

  /**
   * Find a request somebody is entitled to resolve.
   *
   * @param requestId - Which request.
   * @param actorUserId - Who is trying.
   * @param permitted - Which side of it they must be on.
   * @returns The request, when they may resolve it and it is still open.
   * @throws {NotFoundError} If it does not exist or is not theirs — reported
   *   identically, so identifiers cannot be probed.
   * @throws {ValidationError} If it has already been answered, which is a
   *   different thing and worth saying.
   */
  private async requestFor(
    requestId: string,
    actorUserId: string,
    permitted: "requested" | "requester",
  ): Promise<{ requesterUserId: string; requestedUserId: string }> {
    const request = await this.follows.findRequest(requestId);

    if (request === undefined) {
      throw new NotFoundError("No such request");
    }

    const rejection = checkRequestResolution(request, actorUserId, permitted);

    if (rejection === "not_yours_to_resolve") {
      throw new NotFoundError(describeRequestRejection(rejection));
    }

    if (rejection !== undefined) {
      throw new ValidationError(describeRequestRejection(rejection), { field: "requestId" });
    }

    return request;
  }

  /**
   * Block somebody.
   *
   * Stronger than unfollowing. One transaction records the block, ends the
   * follow in both directions, and settles any request either way — a block
   * that recorded itself without severing what it exists to sever would be
   * worse than one that failed.
   *
   * Nothing notifies. `social-graph.md:289` is explicit that a block must not
   * become a social notification.
   *
   * @param blockerUserId - Who is blocking.
   * @param blockedUserId - Who is being blocked.
   * @returns Nothing. Blocking somebody already blocked is the state already
   *   holding rather than a conflict.
   * @throws {NotFoundError} If there is no such account.
   * @throws {ValidationError} If somebody tries to block themselves.
   */
  async block(blockerUserId: string, blockedUserId: string): Promise<void> {
    if (blockerUserId === blockedUserId) {
      throw new ValidationError("You cannot block yourself", { field: "userId" });
    }

    if ((await this.users.findPublic(blockedUserId)) === undefined) {
      throw new NotFoundError("No such user");
    }

    const at = this.clock();

    await withTransaction(this.dataSource, async (tx) => {
      await this.follows.block(tx, blockerUserId, blockedUserId, at);
      await this.follows.unfollow(tx, blockerUserId, blockedUserId);
      await this.follows.unfollow(tx, blockedUserId, blockerUserId);
      await this.follows.cancelRequestsBetween(tx, blockerUserId, blockedUserId, at);
      // Reactions go with the follows. `reactions.md:364` permits a Block to
      // invalidate one, and leaving them would let a blocked person keep
      // contributing to the counts on history they can no longer even see.
      await this.reactions?.severBetween(tx, blockerUserId, blockedUserId);
    });
  }

  /**
   * Remove a block.
   *
   * @param blockerUserId - Who blocked.
   * @param blockedUserId - Who was blocked.
   * @returns Nothing. **Nothing is restored.** The follows the block severed
   *   stay severed, and either party may follow again from scratch — which for
   *   an account requiring approval means asking again
   *   (`social-graph.md:315`).
   */
  async unblock(blockerUserId: string, blockedUserId: string): Promise<void> {
    await withTransaction(this.dataSource, (tx) =>
      this.follows.unblock(tx, blockerUserId, blockedUserId),
    );
  }

  /**
   * Read who the caller has blocked.
   *
   * Only your own, and only the direction you can act on. Who has blocked you
   * is deliberately unreadable: the product must not tell anybody they have
   * been blocked.
   *
   * @param blockerUserId - Whose list. Always the caller.
   * @param limit - How many at most.
   * @param cursor - Where to continue from.
   * @returns The page.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async listBlocked(
    blockerUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<FollowList> {
    const rows = await this.follows.listBlocked(blockerUserId, limit, decodeCursor(cursor));
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return {
      users: rows.map((row) => row.user),
      ...(last === undefined
        ? {}
        : { nextCursor: encodeCursor(last.createdAt, last.otherUserId) }),
    };
  }

  /**
   * Follow a real-world Event, or a Location.
   *
   * No approval, unlike following a person. An Event is shared history and a
   * Location is shared reference data — neither is owned, and their recorders
   * hold provenance rather than authority, so there is nobody to ask.
   *
   * @param followerUserId - Who is following.
   * @param kind - Which sort of context.
   * @param contextId - Which one.
   * @returns Nothing. Following something already followed is the state already
   *   holding rather than a conflict.
   * @throws {NotFoundError} If there is no such Event or place.
   */
  async followContext(
    followerUserId: string,
    kind: "real-world-event" | "location",
    contextId: string,
  ): Promise<void> {
    await this.requireContext(kind, contextId);

    const at = this.clock();

    await withTransaction(this.dataSource, (tx) =>
      kind === "real-world-event"
        ? this.follows.followEvent(tx, followerUserId, contextId, at)
        : this.follows.followLocation(tx, followerUserId, contextId, at),
    );
  }

  /**
   * Stop following a real-world Event, or a Location.
   *
   * @param followerUserId - Who was following.
   * @param kind - Which sort of context.
   * @param contextId - Which one.
   * @returns Nothing. Unfollowing something never followed is not an error: the
   *   caller asked for a state that already holds.
   */
  async unfollowContext(
    followerUserId: string,
    kind: "real-world-event" | "location",
    contextId: string,
  ): Promise<void> {
    await withTransaction(this.dataSource, (tx) =>
      kind === "real-world-event"
        ? this.follows.unfollowEvent(tx, followerUserId, contextId)
        : this.follows.unfollowLocation(tx, followerUserId, contextId),
    );
  }

  /**
   * Check that the thing being followed exists.
   *
   * @param kind - Which sort of context.
   * @param contextId - Which one.
   * @returns Nothing when it exists.
   * @throws {NotFoundError} If it does not. Neither has to belong to the
   *   caller: both are shared, and following somebody else's record of a place
   *   is the point of it being shared.
   */
  private async requireContext(
    kind: "real-world-event" | "location",
    contextId: string,
  ): Promise<void> {
    const found =
      kind === "real-world-event"
        ? await this.realWorldEvents.findById(contextId)
        : await this.locations.findById(contextId);

    if (found === undefined) {
      throw new NotFoundError(
        kind === "real-world-event" ? "No such real-world event" : "No such location",
      );
    }
  }

  /**
   * Read a page of the occurrences somebody follows.
   *
   * @param followerUserId - Whose list. Always the caller.
   * @param limit - How many at most.
   * @param cursor - Where to continue from.
   * @returns The page, each Event whole rather than by identifier.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async listFollowedEvents(
    followerUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<FollowedEventList> {
    const rows = await this.follows.listFollowedEvents(
      followerUserId,
      limit,
      decodeCursor(cursor),
    );
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return {
      realWorldEvents: rows.map((row) => row.event),
      ...(last === undefined
        ? {}
        : { nextCursor: encodeCursor(last.createdAt, last.otherId) }),
    };
  }

  /**
   * Read a page of the places somebody follows.
   *
   * @param followerUserId - Whose list. Always the caller.
   * @param limit - How many at most.
   * @param cursor - Where to continue from.
   * @returns The page, each place whole.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async listFollowedLocations(
    followerUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<FollowedLocationList> {
    const rows = await this.follows.listFollowedLocations(
      followerUserId,
      limit,
      decodeCursor(cursor),
    );
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return {
      locations: rows.map((row) => row.location),
      ...(last === undefined
        ? {}
        : { nextCursor: encodeCursor(last.createdAt, last.otherId) }),
    };
  }

  /**
   * Read who somebody follows, or who follows them.
   *
   * Only your own. Whether follower lists are visible to anybody else is four
   * separate open questions, so nothing here answers them.
   *
   * @param userId - Whose relationships. Always the caller.
   * @param direction - Which way round.
   * @param limit - How many at most.
   * @param cursor - Where to continue from.
   * @returns The page, and where the next continues from when there is more.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async list(
    userId: string,
    direction: "following" | "followers",
    limit: number,
    cursor?: string,
  ): Promise<FollowList> {
    const rows = await this.follows.listPeople(userId, direction, limit, decodeCursor(cursor));
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return {
      users: rows.map((row) => row.user),
      ...(last === undefined
        ? {}
        : { nextCursor: encodeCursor(last.createdAt, last.otherUserId) }),
    };
  }

  /**
   * Read the requests waiting on you.
   *
   * @param requestedUserId - Who was asked. Always the caller.
   * @param limit - How many at most.
   * @param cursor - Where to continue from.
   * @returns The page of pending requests.
   * @throws {ValidationError} If the cursor is not one this service issued.
   */
  async listRequests(
    requestedUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<FollowRequestList> {
    const rows = await this.follows.listPendingRequests(
      requestedUserId,
      limit,
      decodeCursor(cursor),
    );
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;

    return {
      requests: rows.map(({ request, requester }) => ({
        requestId: request.requestId,
        requester,
        status: "pending" as const,
        requestedAt: request.requestedAt.toISOString(),
      })),
      ...(last === undefined
        ? {}
        : { nextCursor: encodeCursor(last.request.requestedAt, last.request.requestId) }),
    };
  }
}

