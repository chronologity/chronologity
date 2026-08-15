import type { Env } from "./env.js";

/** Kafka connection settings derived from the validated environment. */
export interface MessagingConfig {
  readonly brokers: readonly string[];
  readonly clientId: string;
}

export function toMessagingConfig(env: Env): MessagingConfig {
  return {
    brokers: env.KAFKA_BROKERS.split(",").map((broker) => broker.trim()),
    clientId: "chronologity-api",
  };
}
