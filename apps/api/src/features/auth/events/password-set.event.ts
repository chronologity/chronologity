import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * A password credential was set for an Identity.
 *
 * Records that it happened, why, and with which algorithm — never the hash,
 * the salt, or the cost parameters. Event history is permanent: a hash written
 * here could never be rotated away, and parameters recorded here would become
 * a misleading second source of truth once the stored hash was upgraded.
 *
 * The reason matters afterwards. A password set during a reset and one changed
 * by someone signed in are the same state change with very different security
 * meanings.
 */
export type PasswordSet = DomainEvent<
  "PasswordSet",
  { algorithm: string; reason: "registration" | "reset" | "change"; setAt: string }
>;
