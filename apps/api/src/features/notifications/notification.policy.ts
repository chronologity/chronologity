import type { Urgency } from "./notification.schedule.js";

/**
 * Who hears about what, and what may be turned off.
 *
 * Pure, so the rules can be exercised over every combination without a
 * database. Three questions live here, in the order `notifications.md:200`
 * requires they be asked:
 *
 * ```text
 * is there a recipient?  ->  are they authorised?  ->  do they want it?
 * ```
 *
 * The middle question is not here — it needs current state and belongs to the
 * generator. What matters is that it comes second: a preference can never grant
 * somebody a notification about something they were not entitled to know, and
 * this file is arranged so that no caller can ask about preferences without
 * having asked about eligibility first.
 */

/** What a notification is about. */
export type NotificationType =
  | "moment_reacted"
  | "comment_reacted"
  | "moment_commented"
  | "comment_replied"
  | "comment_mentioned"
  | "user_followed"
  | "follow_requested"
  | "follow_request_accepted"
  | "participation_proposed"
  | "participation_accepted"
  | "participation_rejected"
  | "participation_withdrawn"
  | "upload_ready"
  | "upload_rejected"
  | "content_moderated"
  | "password_set"
  | "password_changed"
  | "phone_claimed"
  | "phone_removed"
  | "email_verified"
  | "sessions_revoked"
  | "saved_view_expanded"
  | "location_expanded"
  | "real_world_event_expanded";

/** Which family a notification belongs to. */
export type NotificationCategory =
  | "social"
  | "media"
  | "moderation"
  | "security"
  | "participation"
  | "history";

/** Where a notification can be delivered. */
export type NotificationChannel = "in_app" | "email" | "push";

/** What a notification points at. */
export type NotificationSourceType =
  | "moment"
  | "comment"
  | "user"
  | "upload"
  | "participation"
  | "saved_view"
  | "location"
  | "real_world_event";

/** Which family each type belongs to. */
const CATEGORIES: Readonly<Record<NotificationType, NotificationCategory>> = {
  moment_reacted: "social",
  comment_reacted: "social",
  moment_commented: "social",
  comment_replied: "social",
  comment_mentioned: "social",
  user_followed: "social",
  follow_requested: "social",
  follow_request_accepted: "social",
  participation_proposed: "participation",
  participation_accepted: "participation",
  participation_rejected: "participation",
  participation_withdrawn: "participation",
  upload_ready: "media",
  upload_rejected: "media",
  content_moderated: "moderation",
  password_set: "security",
  password_changed: "security",
  phone_claimed: "security",
  phone_removed: "security",
  email_verified: "security",
  sessions_revoked: "security",
  // History expanding, rather than anybody acting. Deliberately not `social`:
  // somebody who has silenced reactions and follows has not asked to stop
  // hearing that a place they follow has gained a photograph of 1969.
  saved_view_expanded: "history",
  location_expanded: "history",
  real_world_event_expanded: "history",
};

/**
 * Which family a notification belongs to.
 *
 * @param type - What happened.
 * @returns Its category, or undefined for a type nobody recognises — which the
 *   generator treats as nothing to do rather than as a failure, because a topic
 *   gains event types over time and a consumer that dies on the first one it
 *   has not been taught about turns an additive change into an outage.
 */
export function categoryOf(type: string): NotificationCategory | undefined {
  return CATEGORIES[type as NotificationType];
}

/**
 * Whether a category may be switched off.
 *
 * Two may not, and both for the same reason: switching them off would let
 * somebody opt out of being told something that exists for their protection
 * rather than for their interest.
 *
 * Moderation, because 5N established that somebody must be told what was done
 * to their content — an appeal against a decision they were never told about is
 * not a right they have.
 *
 * Security, because every one of those messages describes a step somebody
 * taking over an account has to perform, and a preference that could silence
 * them would be the first thing an attacker turned off.
 * `architecture/notifications.md:696` names account security alongside severe
 * moderation as a mandatory example.
 *
 * `notifications.md:495` asks that required notifications be narrowly defined
 * and warns against labelling engagement as required to bypass preferences.
 * Social and media are the categories that carry engagement, and neither
 * qualifies.
 *
 * @param category - The family.
 * @returns Whether it is delivered regardless of preference.
 */
export function isRequired(category: NotificationCategory): boolean {
  return category === "moderation" || category === "security";
}

/**
 * Whether somebody wants this.
 *
 * @param category - The family.
 * @param enabled - What they chose, or undefined where they have chosen
 *   nothing.
 * @returns Whether to deliver. Absence means yes: somebody who has never opened
 *   the settings has not asked for silence, and an opt-in default would mean a
 *   new account is told nothing at all — including that its upload failed.
 */
export function permits(
  category: NotificationCategory,
  enabled: boolean | undefined,
): boolean {
  return isRequired(category) || (enabled ?? true);
}

/**
 * How much a category is allowed to wait before it is delivered.
 *
 * Separate from `isRequired`, and the pair is the whole of the distinction
 * between the two categories nobody can switch off. Both always arrive; they
 * differ only in whether they arrive now.
 *
 * Security waits for nothing, because by morning the account may be gone.
 * Moderation waits out a quiet window, because the decision will still be there
 * at eight and appealing it is no more possible at three — and waking somebody
 * for it teaches them to silence the device, which silences the security alert
 * too. The cost of over-rating moderation is paid by security.
 *
 * @param category - The family.
 * @returns What the delivery schedule may do with it.
 */
export function urgencyOf(category: NotificationCategory): Urgency {
  if (category === "security") {
    return "immediate";
  }

  return category === "moderation" ? "prompt" : "ordinary";
}

/** What one message says happened. */
export interface ActivityFacts {
  readonly type: string;
  /** Who did it, where anybody did. Absent where nobody is named. */
  readonly actorUserId: string | undefined;
  /** Who it happened to, as the message names them. */
  readonly subjectUserId: string;
}

/**
 * Who should hear about this, if anybody.
 *
 * @param facts - The type, who acted, and who the message names as the subject.
 * @returns The recipient, or undefined when there is nobody to tell. Undefined
 *   when somebody is the subject of their own activity: reacting to your own
 *   Moment or replying to yourself produces nothing, and `notifications.md`
 *   treats self-notification as a rule to define rather than an edge case to
 *   discover. An absent actor is never equal to the subject, so a moderation
 *   decision — which names no actor — always reaches the person it affected.
 */
export function recipientOf(facts: ActivityFacts): string | undefined {
  if (categoryOf(facts.type) === undefined) {
    return undefined;
  }

  // No actor means nobody to have been the subject of their own activity —
  // Chronologity acted, not a person, and the person it acted on is told.
  return facts.actorUserId === facts.subjectUserId ? undefined : facts.subjectUserId;
}

/**
 * What collapses together.
 *
 * Unread activity of one kind about one thing is one entry. The key deliberately
 * carries no time component: `notifications.md:640` leaves the window open, and
 * the window chosen here is "until read", which read state already expresses —
 * so a key that also carried an hour would produce two entries for something
 * somebody has not looked at yet.
 *
 * The recipient is part of the key because two people can be notified about the
 * same activity on the same thing, and their entries must not collapse into
 * one.
 *
 * @param recipientUserId - Who hears about it.
 * @param type - What happened.
 * @param sourceId - What it happened to.
 * @returns A stable key.
 */
export function aggregationKey(
  recipientUserId: string,
  type: string,
  sourceId: string,
): string {
  return `${recipientUserId}:${type}:${sourceId}`;
}

/**
 * Whether unread activity of this kind collapses into one entry.
 *
 * Everything ordinary does: three people reacting to a Moment is one entry, not
 * three, and that is what keeps a list readable.
 *
 * Nothing required does, and the reason is delivery rather than presentation. A
 * delivery is opened once per notification per channel, so a second thing
 * collapsing into a standing entry would be announced to nobody — the first
 * email having already gone. Somebody whose password is changed twice must hear
 * about it twice, and somebody who receives a second moderation decision must
 * be told about that one too, because each carries its own right of appeal.
 *
 * The rule follows `isRequired` exactly rather than listing categories again: a
 * category that must be delivered is a category whose instances must each be
 * delivered.
 *
 * @param category - The family.
 * @returns Whether two of these about one thing become one entry.
 */
export function aggregates(category: NotificationCategory): boolean {
  return !isRequired(category);
}

/**
 * How to describe how many people did something.
 *
 * Named where the reader may see them and counted where they may not, so an
 * aggregated notification never becomes a way to learn who somebody is.
 *
 * @param visibleActors - The actors this reader is entitled to know about, in
 *   the order they acted, most recent first.
 * @param total - How many acted altogether.
 * @returns How many to name and how many are left over. Two named at most: a
 *   notification is a sentence, and "Alex, Sam and four others" is where a
 *   sentence stops being one.
 */
export function describeActors(
  visibleActors: readonly string[],
  total: number,
): { named: string[]; others: number } {
  const named = visibleActors.slice(0, 2);

  return { named, others: Math.max(0, total - named.length) };
}
