/**
 * The rules following has to satisfy.
 *
 * Pure functions, so they need no database and can be exercised exhaustively.
 *
 * What is deliberately absent is any cooldown after a refusal.
 * `social-graph.md:184` requires that repeated requests not become a harassment
 * mechanism, and says the policy belongs to later product design while "the
 * social model must support it". Keeping every request is what supports it;
 * inventing a duration here would answer a question left open.
 */

export type FollowRejection = "self_follow" | "blocked_them" | "blocked_by_them";

export type RequestRejection = "not_yours_to_resolve" | "already_resolved";

/**
 * Check that a follow is between two different people.
 *
 * @param followerUserId - Who is following.
 * @param followedUserId - Who they are following.
 * @param blocks - Which way a block runs between them, if either way does.
 *   Defaults to neither, so a caller with no blocking to consider need not say
 *   so.
 * @returns The reason to refuse, or undefined. Nobody follows themselves: their
 *   own history is already theirs, and a self-follow would quietly double every
 *   count that ever gets built on this. A block refuses in either direction,
 *   and which direction it runs decides what the caller is told.
 */
export function checkFollow(
  followerUserId: string,
  followedUserId: string,
  blocks: { theyBlockedMe: boolean; iBlockedThem: boolean } = {
    theyBlockedMe: false,
    iBlockedThem: false,
  },
): FollowRejection | undefined {
  if (followerUserId === followedUserId) {
    return "self_follow";
  }

  // The order matters, and not only for tidiness. Being blocked is reported as
  // the account not existing, so it must be decided before anything that would
  // reveal the account does exist.
  if (blocks.theyBlockedMe) {
    return "blocked_by_them";
  }

  if (blocks.iBlockedThem) {
    return "blocked_them";
  }

  return undefined;
}

/**
 * Check that somebody may resolve a request, and that it is still open.
 *
 * @param request - Who it is addressed to, and how far it has got.
 * @param actorUserId - Who is trying to resolve it.
 * @param permitted - Whose request it is to resolve: the person asked, for an
 *   accept or a decline, and the asker for a cancellation.
 * @returns The reason to refuse, or undefined. The two are separate because
 *   they mean different things to a caller: one is "not yours", which is
 *   reported as absence, and the other is "too late", which is not.
 */
export function checkRequestResolution(
  request: { requesterUserId: string; requestedUserId: string; status: string },
  actorUserId: string,
  permitted: "requested" | "requester",
): RequestRejection | undefined {
  const owner =
    permitted === "requested" ? request.requestedUserId : request.requesterUserId;

  if (owner !== actorUserId) {
    return "not_yours_to_resolve";
  }

  if (request.status !== "pending") {
    return "already_resolved";
  }

  return undefined;
}

/**
 * Say why a follow was refused.
 *
 * @param reason - What the check found.
 * @returns A message for the person who asked.
 *
 *   `blocked_by_them` reads as the account not existing, and is reported with
 *   the status that goes with that. `social-graph.md:289` forbids telling
 *   somebody they have been blocked — "the blocked User may infer the
 *   relationship from product behavior, but the product should not generate a
 *   social notification announcing the block" — so the answer is the one a
 *   handle nobody holds would give.
 *
 *   `blocked_them` is said plainly. The person asking did the blocking and
 *   already knows; a silence there would only be confusing.
 */
export function describeFollowRejection(reason: FollowRejection): string {
  switch (reason) {
    case "self_follow":
      return "You cannot follow yourself";
    case "blocked_them":
      return "You have blocked this person";
    case "blocked_by_them":
      return "No such user";
  }
}

/**
 * Say why a request could not be resolved.
 *
 * @param reason - What the check found.
 * @returns A message for the person who asked. Only `already_resolved` is ever
 *   shown: a request that is not yours is reported as one that does not exist,
 *   so that identifiers cannot be probed.
 */
export function describeRequestRejection(reason: RequestRejection): string {
  return reason === "already_resolved"
    ? "That request has already been answered"
    : "No such request";
}
