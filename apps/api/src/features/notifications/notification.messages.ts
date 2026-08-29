import type { Notification } from "@chronologity/contracts";

/**
 * Turning a notification into words.
 *
 * Pure, and given only a rendered notification — which is the reason this file
 * cannot leak anything. A `Notification` carries a type, a source identifier,
 * and the actors the reader was already entitled to be told about. It has no
 * field for a caption, a comment, a place, or an Event name, so no wording
 * built from one can accidentally include them. The privacy of push text is a
 * property of the input rather than a rule anybody here has to remember.
 *
 * What is left to decide is how much of the permitted material each channel
 * uses, and the two answers differ. `product/notifications.md:289` requires
 * stricter defaults outside the application because a lock screen is visible to
 * whoever is standing nearby — so email names people and push counts them.
 * Somebody glancing at a phone on a table learns that something happened and
 * not who it involved.
 */

/** What actually gets sent. */
export interface Message {
  readonly subject: string;
  readonly body: string;
}

/** Something somebody did, which needs a person in front of it. */
interface Activity {
  readonly subject: string;
  /** Completed by a phrase naming who acted: "{who} reacted to your Moment." */
  readonly predicate: string;
}

/** Something that happened, with nobody to name. */
interface Occurrence {
  readonly subject: string;
  readonly sentence: string;
}

/**
 * Wording for the things other people do.
 *
 * Every one of these is deliberately about the recipient's own thing — your
 * Moment, your comment, you. None of them says what the Moment was of or what
 * the comment said, which is the line `product/notifications.md:281` draws:
 * enough to be useful, never a reproduction of the content.
 */
const ACTIVITIES: Readonly<Record<string, Activity>> = {
  moment_reacted: { subject: "Someone reacted to your Moment", predicate: "reacted to your Moment" },
  comment_reacted: {
    subject: "Someone reacted to your comment",
    predicate: "reacted to your comment",
  },
  moment_commented: {
    subject: "A new comment on your Moment",
    predicate: "commented on your Moment",
  },
  comment_replied: { subject: "A reply to your comment", predicate: "replied to your comment" },
  // Nothing here names the Moment or says anything it contains. The person
  // being asked frequently cannot read it, and a subject line is the last place
  // to disclose what every other surface is careful about.
  participation_proposed: {
    subject: "Someone says you were there",
    predicate: "said you were part of a Moment",
  },
  participation_accepted: {
    subject: "Someone confirmed they were there",
    predicate: "confirmed they were part of your Moment",
  },
  // Said plainly rather than as an absence of an answer. A creator who cannot
  // tell refusal from silence will ask again outside the product, which is the
  // conversation this model deliberately does not carry.
  participation_rejected: {
    subject: "Someone answered about your Moment",
    predicate: "said they were not part of your Moment",
  },
  participation_withdrawn: {
    subject: "Someone withdrew from your Moment",
    predicate: "withdrew from your Moment",
  },
  comment_mentioned: {
    subject: "You were mentioned in a comment",
    predicate: "mentioned you in a comment",
  },
  user_followed: { subject: "A new follower", predicate: "started following you" },
  follow_requested: { subject: "A request to follow you", predicate: "asked to follow you" },
  follow_request_accepted: {
    subject: "Your follow request was accepted",
    predicate: "accepted your follow request",
  },
};

/**
 * Wording for the things that happen without anybody doing them to you.
 *
 * The moderation line names no moderator, which is 5N's rule carried through to
 * the one place it would be easiest to break: an email is exactly where a name
 * would feel natural and would undo reviewer privacy for good.
 *
 * The security lines say what changed and never what it changed to. "Your
 * password was changed" is the whole message; anything more would put a fact
 * about a credential into a mailbox.
 */
const OCCURRENCES: Readonly<Record<string, Occurrence>> = {
  upload_ready: {
    subject: "Your upload is ready",
    sentence: "Your upload has finished processing and is ready to use.",
  },
  upload_rejected: {
    subject: "Your upload could not be processed",
    sentence: "Your upload could not be processed. You can try uploading it again.",
  },
  content_moderated: {
    subject: "A decision about your content",
    sentence:
      "A moderation decision was made about something you posted. You can see it, and appeal it, in your moderation history.",
  },
  password_set: {
    subject: "A password was set on your account",
    sentence: "A password was set on your account. If this was not you, reset it immediately.",
  },
  password_changed: {
    subject: "Your password was changed",
    sentence: "Your password was changed. If this was not you, reset it immediately.",
  },
  phone_claimed: {
    subject: "A phone number was added to your account",
    sentence:
      "A phone number was added to your account. If this was not you, remove it and change your password.",
  },
  phone_removed: {
    subject: "A phone number was removed from your account",
    sentence:
      "A phone number was removed from your account. If this was not you, change your password.",
  },
  email_verified: {
    subject: "Your email address was verified",
    sentence: "Your email address was verified.",
  },
  sessions_revoked: {
    subject: "You were signed out everywhere",
    sentence:
      "Every session on your account was signed out. If this was not you, change your password.",
  },
};

/**
 * How many people a notification is about altogether.
 *
 * @param notification - The rendered notification.
 * @returns The count, named and unnamed together. The unnamed are people the
 *   reader may not know about — suspended, or separated by a Block — and they
 *   still count towards "four people reacted" without ever being identified.
 */
function actorCount(notification: Notification): number {
  return notification.actors.length + notification.otherActors;
}

/**
 * Who acted, in words, for a channel that may name them.
 *
 * @param notification - The rendered notification.
 * @returns A phrase to put in front of a predicate. "Someone" where nobody may
 *   be named, which happens when every actor is one the reader is not entitled
 *   to know about — counted rather than identified, so an aggregated
 *   notification never becomes a way to learn who somebody is.
 */
function namedWho(notification: Notification): string {
  const names = notification.actors.map((actor) => actor.displayName);
  const rest = notification.otherActors;

  if (names.length === 0) {
    return countedWho(rest);
  }

  if (rest > 0) {
    return `${names.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
  }

  return names.length === 2 ? `${names[0]} and ${names[1]}` : (names[0] ?? "Someone");
}

/**
 * Who acted, in words, for a channel that may not name them.
 *
 * @param count - How many acted.
 * @returns A phrase carrying the number and nothing else.
 */
function countedWho(count: number): string {
  if (count <= 1) {
    return "Someone";
  }

  return `${count} people`;
}

/**
 * Words for one notification on a channel that may name people.
 *
 * @param notification - The rendered notification.
 * @returns The message, or undefined for a type this has no wording for —
 *   which the dispatcher treats as nothing to send rather than as a failure,
 *   for the same reason the generator tolerates an unrecognised event type: a
 *   vocabulary grows, and a delivery that threw on the first new value would
 *   stall every delivery behind it.
 */
export function composeEmail(notification: Notification): Message | undefined {
  const occurrence = OCCURRENCES[notification.type];

  if (occurrence !== undefined) {
    return { subject: occurrence.subject, body: occurrence.sentence };
  }

  const activity = ACTIVITIES[notification.type];

  if (activity === undefined) {
    return undefined;
  }

  const who = namedWho(notification);

  return { subject: activity.subject, body: `${who} ${activity.predicate}.` };
}

/**
 * Words for one notification on a channel whose text may be read by anybody
 * standing nearby.
 *
 * @param notification - The rendered notification.
 * @returns The message, or undefined for a type this has no wording for. Nobody
 *   is named, however entitled the recipient is to know who they are: the
 *   recipient is not necessarily the only person who will see this, and the
 *   application shows the names once they open it.
 */
export function composePush(notification: Notification): Message | undefined {
  const occurrence = OCCURRENCES[notification.type];

  if (occurrence !== undefined) {
    return { subject: occurrence.subject, body: occurrence.sentence };
  }

  const activity = ACTIVITIES[notification.type];

  if (activity === undefined) {
    return undefined;
  }

  return {
    subject: activity.subject,
    body: `${countedWho(actorCount(notification))} ${activity.predicate}.`,
  };
}

/**
 * Words for several notifications gathered into one message.
 *
 * @param notifications - Everything due for one person on one channel.
 * @param names - Whether people may be named, which is to say whether this is
 *   going to a mailbox or to a lock screen.
 * @returns The digest, or undefined when nothing in it could be worded. The
 *   count in the subject is of what is actually said, not of what was gathered,
 *   so a digest never claims to contain more than it does.
 */
export function composeDigest(
  notifications: readonly Notification[],
  names: boolean,
): Message | undefined {
  const lines = notifications
    .map((one) => (names ? composeEmail(one) : composePush(one)))
    .filter((message): message is Message => message !== undefined)
    .map((message) => message.body);

  if (lines.length === 0) {
    return undefined;
  }

  return {
    subject:
      lines.length === 1
        ? "What happened on Chronologity"
        : `${lines.length} things happened on Chronologity`,
    body: lines.join("\n"),
  };
}
