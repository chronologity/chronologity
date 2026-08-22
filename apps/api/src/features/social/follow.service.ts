import type {
  FollowList,
  FollowOutcome,
  FollowRequest,
  FollowRequestList,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
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
 * **Following grants nothing yet.** Every Moment is private to its author, so a
 * follower can see no more after following than before. That is not an
 * omission: `social-graph.md:167` requires that a Follow "must never bypass the
 * visibility rules of individual Moments", and what a follower may see is
 * decided when those rules gain a second value to hold.
 */
export class FollowService {
  /**
   * Build the follow service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param follows - Where following is stored.
   * @param users - Used to check that the other account exists.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly follows: FollowRepository,
    private readonly users: UserRepository,
    private readonly clock: () => Date = () => new Date(),
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
    const rejection = checkFollow(followerUserId, followedUserId);

    if (rejection !== undefined) {
      throw new ValidationError(describeFollowRejection(), { field: "userId" });
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
      ...(last === undefined ? {} : { nextCursor: encodeCursor(last.createdAt) }),
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
        : { nextCursor: encodeCursor(last.request.requestedAt) }),
    };
  }
}

/**
 * Encode where the next page continues from.
 *
 * Both lists are ordered by a single moment, so that moment is the whole
 * cursor. Opaque so a caller does not come to depend on the ordering.
 *
 * @param at - The moment the last row on the page carries.
 * @returns The cursor to hand back.
 */
function encodeCursor(at: Date): string {
  return Buffer.from(at.toISOString(), "utf8").toString("base64url");
}

/**
 * Decode where a page should continue from.
 *
 * @param cursor - What a caller sent back, or undefined for the first page.
 * @returns The moment to continue before, or undefined.
 * @throws {ValidationError} If it is not a cursor this module produced. Refused
 *   rather than ignored: silently starting again would repeat a page the caller
 *   believes it has read.
 */
function decodeCursor(cursor?: string): Date | undefined {
  if (cursor === undefined) {
    return undefined;
  }

  const at = new Date(Buffer.from(cursor, "base64url").toString("utf8"));

  if (Number.isNaN(at.getTime())) {
    throw new ValidationError("Malformed cursor", { field: "cursor" });
  }

  return at;
}
