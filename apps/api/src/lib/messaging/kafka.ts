import { Kafka, type Admin } from "kafkajs";
import type { MessagingConfig } from "../../config/messaging-config.js";
import type { HealthCheckable } from "../health.js";

/**
 * The API's Kafka boundary.
 *
 * Kafka is transport, never a source of truth (ADR-013). Producers, consumers,
 * and envelope handling arrive in Phase 4; this establishes the connection and
 * proves it works.
 */
export interface Messaging extends HealthCheckable {
  readonly kafka: Kafka;
  close(): Promise<void>;
}

export function createMessaging(config: MessagingConfig): Messaging {
  const kafka = new Kafka({
    clientId: config.clientId,
    brokers: [...config.brokers],
    retry: { initialRetryTime: 100, retries: 3 },
  });

  let admin: Admin | undefined;

  return {
    name: "kafka",
    kafka,
    async checkHealth() {
      admin ??= kafka.admin();
      await admin.connect();
      await admin.listTopics();
    },
    async close() {
      await admin?.disconnect();
      admin = undefined;
    },
  };
}
