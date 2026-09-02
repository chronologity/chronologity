import type {
  AppealOutcome,
  ModerationState,
  ReportReason,
  ReportStatus,
  ReviewPriority,
} from "@chronologity/contracts";

/**
 * What each moderation state does.
 *
 * Pure, so the rules can be exercised exhaustively without a database, and
 * separate from the visibility policy beside it because the two answer
 * different questions: that one asks whether this Viewer is entitled to look,
 * this one asks what Chronologity has decided to do about the thing regardless
 * of who is asking.
 *
 * Every function here defaults to the restrictive answer for a state it does
 * not recognise. Deny-by-default has to survive a widened column constraint
 * that forgot this file, and the consequence of the other choice is publishing
 * something a moderator removed.
 */

/** How old somebody must be for age-restricted content. */
const ADULT_AGE = 18;

/** How many reports inside the window count as arriving together. */
const BURST_COUNT = 5;

/** How long that window is, in milliseconds. */
const BURST_WINDOW_MS = 60 * 60 * 1000;

/**
 * Reasons that describe an immediate danger to somebody.
 *
 * Used for ordering a queue and nothing else. `moderation.md:614` forbids
 * report characteristics from establishing that content violates policy, so
 * this ranks attention rather than guilt.
 */
const SEVERE_REASONS: ReadonlySet<ReportReason> = new Set([
  "threat",
  "illegal_content",
  "sexual_content",
]);

/** Reasons that describe harm to a person without immediate danger. */
const ELEVATED_REASONS: ReadonlySet<ReportReason> = new Set([
  "harassment",
  "hate",
  "privacy_violation",
]);

/**
 * Whether a state hides a subject from everybody but its author.
 *
 * The author is not consulted here: their own history stays readable to them
 * whatever has been decided about it, which is what makes an appeal possible,
 * and that rule belongs to the caller because it is about people rather than
 * about states.
 *
 * @param state - What Chronologity has decided about the subject.
 * @returns Whether other people stop seeing it. True for an unrecognised state:
 *   a state nobody understands must withhold rather than publish.
 */
export function hidesFromOthers(state: ModerationState): boolean {
  switch (state) {
    case "allowed":
    case "warned":
    case "restricted_from_amplification":
    case "restricted_to_authorized_audience":
    case "age_restricted":
      return false;
    case "removed":
    case "temporarily_unavailable":
      return true;
    default:
      return true;
  }
}

/**
 * Whether a state narrows a subject to the audience its author chose.
 *
 * Overrides a public visibility rather than being overridden by it: the state
 * exists precisely for something whose author intended it for everybody and
 * which Chronologity has decided should reach fewer people.
 *
 * @param state - What Chronologity has decided about the subject.
 * @returns Whether only the author's audience may see it.
 */
export function narrowsToAudience(state: ModerationState): boolean {
  return state === "restricted_to_authorized_audience";
}

/**
 * Whether a state requires the Viewer to be an adult.
 *
 * @param state - What Chronologity has decided about the subject.
 * @returns Whether age gates access to it.
 */
export function requiresAdult(state: ModerationState): boolean {
  return state === "age_restricted";
}

/**
 * Whether a state keeps a subject out of the surfaces that amplify.
 *
 * The line `moderation.md:211` draws: allowed to exist, allowed to be accessed
 * directly, not eligible for Discovery, broad Search, or recommendation. Read
 * by 5O and 5P and by significance, which is why it is broader than
 * `hidesFromOthers` — something hidden outright is also not amplified, and
 * something age-restricted should not be recommended to people who cannot see
 * it.
 *
 * @param state - What Chronologity has decided about the subject.
 * @returns Whether it is excluded from amplification. True for an unrecognised
 *   state.
 */
export function suppressesAmplification(state: ModerationState): boolean {
  switch (state) {
    case "allowed":
    case "warned":
      return false;
    case "restricted_from_amplification":
    case "restricted_to_authorized_audience":
    case "age_restricted":
    case "temporarily_unavailable":
    case "removed":
      return true;
    default:
      return true;
  }
}

/**
 * Whether a state should be shown to a Viewer as a warning.
 *
 * The "context / warning" step of `moderation.md:106`, and the one state whose
 * whole purpose is to be visible: it restricts nothing and exists to tell
 * somebody what they are about to look at.
 *
 * @param state - What Chronologity has decided about the subject.
 * @returns Whether the Viewer is told before they look.
 */
export function carriesWarning(state: ModerationState): boolean {
  return state === "warned";
}

/**
 * Whether somebody is old enough for age-restricted content.
 *
 * @param dateOfBirth - What the account recorded, or undefined when there is no
 *   restricted-data row for them. Undefined is not permission: ambiguous
 *   security-sensitive state defaults to deny, and an account whose birthdate
 *   cannot be found must be treated as too young rather than waved through.
 * @param now - The instant to measure against, passed rather than read so the
 *   boundary can be tested.
 * @returns Whether they have reached eighteen. True on the birthday itself.
 */
export function isAdult(dateOfBirth: Date | undefined, now: Date): boolean {
  if (dateOfBirth === undefined) {
    return false;
  }

  // Compared as a date rather than by subtracting milliseconds, which leap
  // years make wrong: the eighteenth birthday of somebody born on 29 February
  // is a real day in a non-leap year, and dividing an elapsed duration by an
  // average year length puts it on the wrong side of the boundary.
  const eighteenth = new Date(
    Date.UTC(
      dateOfBirth.getUTCFullYear() + ADULT_AGE,
      dateOfBirth.getUTCMonth(),
      dateOfBirth.getUTCDate(),
    ),
  );

  return now.getTime() >= eighteenth.getTime();
}

/**
 * How urgently a report should be looked at.
 *
 * Ordering, and nothing else. This is the whole of the automation
 * `moderation.md:850` permits — "prioritization; classification; obvious spam;
 * safety triage" — and it stops here deliberately: no caller may pass this
 * value where a moderation state is expected, because report characteristics
 * must never establish that content violates policy.
 *
 * @param reportCount - How many separate people have reported the subject.
 *   Bounded by one report per person, so this counts people rather than
 *   submissions.
 * @param reason - Why the most recent reporter said they were reporting it.
 * @returns Where it sits in the queue. A severe reason alone is enough to reach
 *   the top, because one credible threat deserves attention that fifty spam
 *   reports do not.
 */
export function reviewPriority(reportCount: number, reason: ReportReason): ReviewPriority {
  if (SEVERE_REASONS.has(reason)) {
    return reportCount > 1 ? "urgent" : "high";
  }

  if (ELEVATED_REASONS.has(reason)) {
    return reportCount >= BURST_COUNT ? "high" : "normal";
  }

  return reportCount >= BURST_COUNT ? "normal" : "low";
}

/**
 * Whether reports about one subject arrived together.
 *
 * A flag for a moderator to see, and deliberately not an escalation. A burst
 * may mean many people saw something awful at once, or it may mean a group
 * agreed to report somebody; this says which question to ask, and
 * `moderation.md:614` forbids it from answering.
 *
 * @param timestamps - When each report about the subject arrived.
 * @param now - The instant to measure back from.
 * @returns Whether at least five arrived within the last hour.
 */
export function isBurst(timestamps: readonly Date[], now: Date): boolean {
  const since = now.getTime() - BURST_WINDOW_MS;

  return timestamps.filter((at) => at.getTime() >= since).length >= BURST_COUNT;
}

/**
 * Whether a report may move from one status to another.
 *
 * `resolved` and `closed` are terminal. Reopening is not refused because it is
 * unimaginable but because it is not designed: a reporter told their report was
 * resolved and then finding it open again has been told two different things,
 * and whichever is true the product has not decided which.
 *
 * @param from - Where the report is now.
 * @param to - Where a moderator wants to move it.
 * @returns Whether the move is permitted. A move to the status it already holds
 *   is refused: it would append an action recording a decision nobody made.
 */
export function mayTransitionReport(from: ReportStatus, to: ReportStatus): boolean {
  switch (from) {
    case "submitted":
      return to === "under_review" || to === "resolved" || to === "closed";
    case "under_review":
      return to === "resolved" || to === "closed";
    case "resolved":
    case "closed":
      return false;
    default:
      return false;
  }
}

/**
 * Whether deciding an appeal this way undoes what was done.
 *
 * Where "nothing was deleted" stops being a claim and becomes a test: an
 * upheld appeal changes nothing, and a reversed one must restore the subject
 * to what it was before, which is only possible because moderation hid things
 * rather than destroying them.
 *
 * @param outcome - How the appeal was decided.
 * @returns Whether the original action is undone.
 */
export function appealReverses(outcome: AppealOutcome): boolean {
  return outcome === "reversed";
}
