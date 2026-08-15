import { eventEnvelopeSchema, type EventEnvelope } from "@chronologity/contracts";
import type { Kafka, Producer } from "kafkajs";
import type { Logger } from "../logger/logger.js";

/**
 * Publishing integration events.
 *
 * Messages are validated against the shared envelope before they are sent.
 * Kafka accepts any bytes, so an invalid message is only discovered by the
 * consumer that chokes on it — by which time it is in a durable log and the
 * producer that wrote it may be several deploys in the past. Validating here
 * keeps the failure with the code that caused it.
 */

export interface PublishMessage {
  readonly topic: string;
  readonly partitionKey: string;
  readonly envelope: EventEnvelope;
}

export interface EventProducer {
  connect(): Promise<void>;
  publish(messages: readonly PublishMessage[]): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * Build a producer for integration events.
 *
 * @param kafka - The client to produce through.
 * @param logger - Optional.
 * @returns A producer that validates every envelope before sending it.
 */
export function createEventProducer(kafka: Kafka, logger?: Logger): EventProducer {
  let producer: Producer | undefined;

  return {
    async connect() {
      producer ??= kafka.producer({
        // The broker deduplicates retries from this producer, so a retry
        // caused by a lost acknowledgement does not append twice.
        idempotent: true,
        maxInFlightRequests: 5,
        retry: { retries: 5 },
      });

      await producer.connect();
    },

    async publish(messages) {
      if (producer === undefined) {
        throw new Error("Producer used before connect()");
      }

      if (messages.length === 0) {
        return;
      }

      for (const message of messages) {
        const validation = eventEnvelopeSchema.safeParse(message.envelope);

        if (!validation.success) {
          throw new Error(
            `Refusing to publish an invalid envelope for ${message.envelope.eventType}: ${validation.error.message}`,
          );
        }
      }

      // Grouped by topic so each topic is one request rather than one per message.
      const byTopic = new Map<string, PublishMessage[]>();
      for (const message of messages) {
        const existing = byTopic.get(message.topic);
        if (existing === undefined) {
          byTopic.set(message.topic, [message]);
        } else {
          existing.push(message);
        }
      }

      await producer.sendBatch({
        topicMessages: [...byTopic.entries()].map(([topic, topicMessages]) => ({
          topic,
          messages: topicMessages.map((message) => ({
            key: message.partitionKey,
            value: JSON.stringify(message.envelope),
            headers: {
              "event-type": message.envelope.eventType,
              "event-version": String(message.envelope.eventVersion),
              ...(message.envelope.correlationId === undefined
                ? {}
                : { "correlation-id": message.envelope.correlationId }),
            },
          })),
        })),
        // Every in-sync replica must acknowledge. A message the writer believes
        // is durable must survive the loss of the partition leader.
        acks: -1,
      });

      logger?.debug({ count: messages.length }, "Published integration events");
    },

    async disconnect() {
      await producer?.disconnect();
      producer = undefined;
    },
  };
}
