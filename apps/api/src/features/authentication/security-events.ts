import { SECURITY_BOUNDARY, type AccountSecurityChange } from "@chronologity/contracts";
import { enqueueOutboxMessage } from "../../lib/database/outbox.js";
import type { Transaction } from "../../lib/database/transaction.js";
import { topicName } from "../../lib/messaging/topics.js";
import type { UserRepository } from "../users/user.repository.js";

/**
 * Announcing that something changed about how an account is secured.
 *
 * Shared by the three services that can change it, because the alternative was
 * the same twenty lines written three times and drifting apart — and what these
 * events are for is precisely that every one of them looks the same to whoever
 * receives it.
 *
 * Every change announced here is already an audit record. The audit trail is
 * the evidence and this is the message: one is written for whoever investigates
 * afterwards, the other for the account owner at the time, and neither replaces
 * the other. Each is a step somebody taking over an account has to perform, so
 * each is a chance for the real owner to notice.
 *
 * Enqueued in the caller's transaction, so the announcement commits with the
 * change it describes or not at all. A security notification that arrives about
 * something that did not happen is as bad as one that never arrives about
 * something that did.
 */

/**
 * Enqueue a security announcement.
 *
 * @param tx - The caller's transaction, which must be the one the change itself
 *   commits in.
 * @param accounts - Resolves the Identity to the account it signs in to.
 * @param entry - Which Identity, what changed, when, and the request's trace
 *   identifier.
 * @returns Nothing.
 */
export async function announceSecurityChange(
  tx: Transaction,
  accounts: UserRepository,
  entry: {
    identityId: string;
    change: AccountSecurityChange;
    at: Date;
    traceId: string;
  },
): Promise<void> {
  // Resolved here rather than by the consumer, following the events beside
  // this one: a payload carries who the change concerns so that nothing
  // downstream needs a read to find out. Null during registration, which
  // happens before a User exists — the fact is still published, and a consumer
  // with nobody to tell does nothing with it.
  const userId = await accounts.findIdForIdentity(entry.identityId);

  await enqueueOutboxMessage(tx, {
    topic: topicName(SECURITY_BOUNDARY),
    // Partitioned on the Identity, so two changes to one account stay in the
    // order they happened. "Phone added" arriving after "phone removed" would
    // tell somebody the opposite of what occurred.
    partitionKey: entry.identityId,
    aggregateType: "identity",
    aggregateId: entry.identityId,
    aggregateVersion: 0,
    eventType: "AccountSecurityChanged",
    eventVersion: 1,
    payload: {
      identityId: entry.identityId,
      userId: userId ?? null,
      change: entry.change,
      changedAt: entry.at.toISOString(),
    },
    metadata: {
      traceId: entry.traceId,
      correlationId: entry.traceId,
      causationId: undefined,
      // Deliberately absent. The actor is whoever performed the change, and
      // during a takeover that is not the account owner — recording the
      // Identity as its own actor would assert something this code cannot know.
      actorUserId: undefined,
      eventVersion: 1,
      recordedAt: entry.at.toISOString(),
    },
  });
}

/**
 * Whether a wholesale session revocation is worth telling somebody about.
 *
 * @param reason - Why every Session was ended.
 * @returns Whether to announce it. Only a deliberate "sign out everywhere":
 *   revocation also follows a password change and an account deactivation, and
 *   both of those already produce their own message. Announcing the revocation
 *   as well would send two emails about one action, which is how people learn
 *   to ignore the category.
 */
export function announcesRevocation(reason: string): boolean {
  return reason === "user_logout_all";
}
