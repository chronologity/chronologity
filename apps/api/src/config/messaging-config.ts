import type { Env } from "./env.js";

/** Kafka connection settings derived from the validated environment. */
export interface MessagingConfig {
  readonly brokers: readonly string[];
  readonly clientId: string;
}

/**
 * Derive Kafka settings from the environment.
 *
 * @param env - The validated environment.
 * @returns Kafka connection settings.
 */
export function toMessagingConfig(env: Env): MessagingConfig {
  return {
    brokers: env.KAFKA_BROKERS.split(",").map((broker) => broker.trim()),
    clientId: "chronologity-api",
  };
}
