import {
  HANDLE_MAXIMUM_LENGTH,
  HANDLE_MINIMUM_LENGTH,
  normalizeHandle,
} from "../users/user.handle-policy.js";

/**
 * Finding who a comment refers to.
 *
 * Pure, and deliberately only half the job: this reads handles out of text, and
 * resolving them to people is the service's business. `comments.md:503`
 * requires a mention to refer to stable identity rather than to a handle, so
 * what is stored is a person — and this is only how that person is found.
 *
 * A mention says a comment refers to somebody in conversation. It never asserts
 * that they were present for the experience (`comments.md:489`); that is a tag
 * on a Moment, which is a different thing Chronologity does not yet have.
 */

/**
 * How many people one comment may refer to.
 *
 * `comments.md:517` anticipates limits on repeated or mass mentions. Ten is
 * generous for a conversation and small enough that a comment cannot become a
 * way of reaching a crowd.
 */
export const MAXIMUM_MENTIONS = 10;

/**
 * Handles as they appear in text.
 *
 * The same characters a handle may contain, bounded the same way, and required
 * to start at a word boundary so that an email address does not read as a
 * mention of whatever follows the `@`.
 */
const MENTION_PATTERN = new RegExp(
  `(?<![\\w@])@([a-zA-Z0-9_]{${HANDLE_MINIMUM_LENGTH},${HANDLE_MAXIMUM_LENGTH}})`,
  "g",
);

/**
 * Read the handles a comment mentions.
 *
 * @param body - What was typed.
 * @returns The normalised handles, each once, in the order they first appear.
 *   Normalised because that is how a handle resolves to a person; deduplicated
 *   because mentioning somebody twice in one comment is still one mention.
 */
export function findMentionedHandles(body: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const match of body.matchAll(MENTION_PATTERN)) {
    // The whole match rather than the captured group: the group is optional to
    // TypeScript and never absent in fact, and a guard that cannot fire is a
    // branch no test can honestly cover. Dropping the leading `@` says the same
    // thing with nothing unreachable.
    const handle = normalizeHandle(match[0].slice(1));

    if (!seen.has(handle)) {
      seen.add(handle);
      found.push(handle);
    }
  }

  return found;
}
