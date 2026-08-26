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
  | "upload_ready"
  | "upload_rejected"
  | "content_moderated";

/** Which family a notification belongs to. */
export type NotificationCategory = "social" | "media" | "moderation";

/** Where a notification can be delivered. */
export type NotificationChannel = "in_app" | "email" | "push";

/** What a notification points at. */
export type NotificationSourceType = "moment" | "comment" | "user" | "upload";

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
  upload_ready: "media",
  upload_rejected: "media",
  content_moderated: "moderation",
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
 * Moderation may not. 5N established that somebody must be told what was done
 * to their content, because an appeal against a decision they were never told
 * about is not a right they have — and a preference that could silence it would
 * hand people a way to opt out of being answerable to.
 *
 * `notifications.md:495` asks that required notifications be narrowly defined
 * and warns against labelling engagement as required to bypass preferences. One
 * category qualifies.
 *
 * @param category - The family.
 * @returns Whether it is delivered regardless of preference.
 */
export function isRequired(category: NotificationCategory): boolean {
  return category === "moderation";
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
