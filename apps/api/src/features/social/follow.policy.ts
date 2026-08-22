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

export type FollowRejection = "self_follow";

export type RequestRejection = "not_yours_to_resolve" | "already_resolved";

/**
 * Check that a follow is between two different people.
 *
 * @param followerUserId - Who is following.
 * @param followedUserId - Who they are following.
 * @returns The reason to refuse, or undefined. Nobody follows themselves: their
 *   own history is already theirs, and a self-follow would quietly double every
 *   count that ever gets built on this.
 */
export function checkFollow(
  followerUserId: string,
  followedUserId: string,
): FollowRejection | undefined {
  return followerUserId === followedUserId ? "self_follow" : undefined;
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
 * Takes no reason because there is only one. A parameter that can hold a single
 * value tells a reader nothing.
 *
 * @returns A message for the person who asked.
 */
export function describeFollowRejection(): string {
  return "You cannot follow yourself";
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
