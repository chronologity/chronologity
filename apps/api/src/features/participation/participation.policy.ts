import { MAXIMUM_PARTICIPANTS } from "@chronologity/contracts";

/**
 * The rules participation has to satisfy.
 *
 * Pure functions, so they need no database and can be exercised exhaustively.
 *
 * The rule that is *not* here is permanence. A rejected or withdrawn
 * participation can never be proposed again, and that is enforced by a unique
 * constraint on `(moment_id, user_id)` rather than by a check in this file —
 * see `20260904090000-add-participation.sql`. A rule the database keeps cannot
 * be forgotten by a caller who takes a different path to the same table.
 */

export type ProposalRejection =
  | "not_your_moment"
  | "self_participation"
  | "refused_by_them"
  | "blocked_by_them"
  | "blocked_them"
  | "too_many_participants";

export type ResolutionRejection = "not_yours_to_answer" | "already_answered";

export type RemovalRejection = "not_yours_to_remove" | "already_answered";

/**
 * Check that somebody may propose a participation.
 *
 * @param proposal - Who is proposing, who is named, and whose Moment it is.
 * @param existing - How many people the Moment already names, counting
 *   proposals as well as acceptances: a pending proposal holds its place, or a
 *   hundred could accept out of a hundred and fifty asked.
 * @param barriers - Whether the named person has refused proposals from the
 *   proposer, and which way a Block runs between them. Defaults to none, so a
 *   caller with nothing to consider need not say so.
 * @returns The reason to refuse, or undefined.
 */
export function checkProposal(
  proposal: { proposerUserId: string; namedUserId: string; authorUserId: string },
  existing: number,
  barriers: { refusedMe: boolean; theyBlockedMe: boolean; iBlockedThem: boolean } = {
    refusedMe: false,
    theyBlockedMe: false,
    iBlockedThem: false,
  },
): ProposalRejection | undefined {
  // Authorship first, and reported as though the Moment were not there. Only a
  // creator may propose, so somebody who is not the creator must not learn from
  // this call that the Moment exists.
  if (proposal.proposerUserId !== proposal.authorUserId) {
    return "not_your_moment";
  }

  // Authorship already records that the creator was there. A second, weaker
  // claim about the same fact would be a thing they could then withdraw,
  // leaving a Moment whose author says they were not present.
  if (proposal.namedUserId === proposal.authorUserId) {
    return "self_participation";
  }

  // Before the count, because a person who has refused you must get the same
  // answer whether the Moment is full or empty. Ordering it after would let a
  // proposer distinguish the two.
  if (barriers.theyBlockedMe) {
    return "blocked_by_them";
  }

  if (barriers.iBlockedThem) {
    return "blocked_them";
  }

  if (barriers.refusedMe) {
    return "refused_by_them";
  }

  if (existing >= MAXIMUM_PARTICIPANTS) {
    return "too_many_participants";
  }

  return undefined;
}

/**
 * Check that somebody may answer a proposal, and that it is still a question.
 *
 * @param participation - Who it names and how far it has got.
 * @param actorUserId - Who is trying to answer it.
 * @returns The reason to refuse, or undefined. The two are separate because
 *   they mean different things: one is "not yours", reported as absence, and
 *   the other is "already answered", which is not.
 */
export function checkResolution(
  participation: { userId: string; status: string },
  actorUserId: string,
): ResolutionRejection | undefined {
  // Only the person named may establish their own participation. Invariant 2,
  // and the reason the word is not "tagging".
  if (participation.userId !== actorUserId) {
    return "not_yours_to_answer";
  }

  if (participation.status !== "proposed") {
    return "already_answered";
  }

  return undefined;
}

/**
 * Check a removal, which is two different acts sharing a verb.
 *
 * A participant **withdraws** something they accepted, and that is permanent.
 * A creator **cancels** a proposal nobody has answered, which is not a refusal
 * and leaves them free to ask again.
 *
 * @param participation - Who it names, whose Moment it is, and its status.
 * @param actorUserId - Who is removing it.
 * @returns What kind of removal this is, or the reason to refuse. A creator
 *   cannot remove an accepted participation: that record belongs to the person
 *   who confirmed it, and their recourse is to delete the Moment.
 */
export function checkRemoval(
  participation: { userId: string; authorUserId: string; status: string },
  actorUserId: string,
): { act: "withdraw" | "cancel" } | { reason: RemovalRejection } {
  if (participation.userId === actorUserId) {
    return participation.status === "accepted"
      ? { act: "withdraw" }
      : { reason: "already_answered" };
  }

  if (participation.authorUserId === actorUserId) {
    return participation.status === "proposed"
      ? { act: "cancel" }
      : { reason: "not_yours_to_remove" };
  }

  return { reason: "not_yours_to_remove" };
}

/**
 * Say why a proposal was refused.
 *
 * @param reason - What the check found.
 * @returns A message for the person who proposed.
 *
 *   `blocked_by_them` and `refused_by_them` both read as the account not
 *   existing. `social-graph.md:289` forbids announcing a Block, and a refusal
 *   deserves the same silence for a stronger reason: it exists precisely so
 *   somebody can stop being asked, and telling the asker they have been refused
 *   hands them the information needed to ask another way.
 *
 *   `not_your_moment` reads as the Moment not existing, so that identifiers
 *   cannot be probed for whose history they belong to.
 */
export function describeProposalRejection(reason: ProposalRejection): string {
  switch (reason) {
    case "not_your_moment":
      return "No such Moment";
    case "self_participation":
      return "You recorded this Moment, which already says you were there";
    case "blocked_them":
      return "You have blocked this person";
    case "blocked_by_them":
    case "refused_by_them":
      return "No such user";
    case "too_many_participants":
      return `A Moment may name at most ${MAXIMUM_PARTICIPANTS} people`;
  }
}

/**
 * Say why a proposal could not be answered.
 *
 * @param reason - What the check found.
 * @returns A message for the person who asked. Only `already_answered` is ever
 *   shown: something that is not yours is reported as not existing.
 */
export function describeResolutionRejection(reason: ResolutionRejection): string {
  return reason === "already_answered"
    ? "That participation has already been answered"
    : "No such participation";
}
