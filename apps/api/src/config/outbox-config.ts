import type { Env } from "./env.js";

/**
 * How the outbox is kept, as opposed to how it is delivered.
 *
 * Separate from the Kafka settings on purpose. Retention is a policy about a
 * PostgreSQL table, and a Kafka client should not be handed a field it has no
 * use for.
 */
export interface OutboxConfig {
  /**
   * How long a published message is kept before it is swept, in milliseconds.
   * Zero means sweep as soon as it is published.
   */
  readonly retentionMs: number;
}

/**
 * Derive outbox retention from the environment.
 *
 * @param env - The validated environment.
 * @returns How long published messages are kept.
 */
export function toOutboxConfig(env: Env): OutboxConfig {
  return { retentionMs: env.OUTBOX_RETENTION_HOURS * 60 * 60 * 1_000 };
}
