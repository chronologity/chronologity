import { eventEnvelopeSchema, type EventEnvelope } from "@chronologity/contracts";
import type { Consumer, Kafka } from "kafkajs";
import type { Logger } from "../logger/logger.js";
import { createEventProducer } from "./producer.js";
import { deadLetterTopic } from "./topics.js";

/**
 * Consuming integration events.
 *
 * Delivery is at-least-once, so a handler will eventually see the same message
 * twice — after a rebalance, a retry, or a crash between processing and commit.
 * That is not an edge case to guard against; it is the normal operating mode,
 * and handlers must be idempotent.
 *
 * A message that cannot be processed after its retries is moved to a
 * dead-letter topic rather than retried forever, because an unprocessable
 * message at the head of a partition otherwise blocks every message behind it.
 */

export interface ConsumedEvent {
  readonly topic: string;
  readonly partition: number;
  readonly offset: string;
  readonly envelope: EventEnvelope;
}

export type EventHandler = (event: ConsumedEvent) => Promise<void>;

export interface ConsumerOptions {
  readonly kafka: Kafka;
  /** Consumer group: one per logical workload, so one lagging consumer never blocks another. */
  readonly groupId: string;
  readonly topics: readonly string[];
  readonly handler: EventHandler;
  readonly logger?: Logger;
  /** Attempts before a message is dead-lettered. */
  readonly maxAttempts?: number;
}

export interface EventConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Build a consumer for integration events.
 *
 * @param options - The client, the consumer group, the topics, the handler, an
 *   optional logger, and how many attempts a message gets before it is set aside.
 * @returns A consumer that can be started and stopped.
 */
export function createEventConsumer(options: ConsumerOptions): EventConsumer {
  const { kafka, groupId, topics, handler, logger, maxAttempts = DEFAULT_MAX_ATTEMPTS } = options;

  let consumer: Consumer | undefined;
  const deadLetterProducer = createEventProducer(kafka, logger);

  return {
    async start() {
      consumer = kafka.consumer({ groupId });

      await consumer.connect();
      await deadLetterProducer.connect();

      for (const topic of topics) {
        await consumer.subscribe({ topic, fromBeginning: true });
      }

      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          const raw = message.value?.toString();

          if (raw === undefined) {
            logger?.warn({ topic, partition }, "Skipping message with no value");
            return;
          }

          let envelope: EventEnvelope;

          try {
            envelope = eventEnvelopeSchema.parse(JSON.parse(raw));
          } catch (error) {
            // Unparseable on arrival: no number of retries will change that,
            // so it goes straight aside rather than through the retry loop.
            logger?.error({ err: error, topic, partition }, "Malformed message, dead-lettering");
            await sendToDeadLetter(topic, raw, message.key?.toString() ?? "unknown");
            return;
          }

          const consumed: ConsumedEvent = {
            topic,
            partition,
            offset: message.offset,
            envelope,
          };

          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
              await handler(consumed);
              return;
            } catch (error) {
              const exhausted = attempt === maxAttempts;

              logger?.[exhausted ? "error" : "warn"](
                {
                  err: error,
                  topic,
                  partition,
                  offset: message.offset,
                  attempt,
                  eventId: envelope.eventId,
                  traceId: envelope.correlationId,
                },
                exhausted ? "Handler failed, dead-lettering" : "Handler failed, retrying",
              );

              if (exhausted) {
                await sendToDeadLetter(topic, raw, envelope.aggregate.id);
                return;
              }

              // Backs off so a dependency that is briefly unavailable is not
              // hammered by the retry that is waiting for it to recover.
              await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100));
            }
          }
        },
      });
    },

    async stop() {
      // Disconnecting the consumer first stops new work arriving before the
      // dead-letter producer it might still need goes away.
      await consumer?.disconnect();
      await deadLetterProducer.disconnect();
      consumer = undefined;
    },
  };

  /**
   * Set a message aside rather than leaving it to block its partition.
   *
   * @param topic - The topic it could not be processed from.
   * @param raw - The message exactly as received, so nothing is lost.
   * @param key - Partition key for the dead-letter record.
   * @returns Nothing.
   */
  async function sendToDeadLetter(topic: string, raw: string, key: string): Promise<void> {
    const producer = kafka.producer();

    try {
      await producer.connect();
      await producer.send({
        topic: deadLetterTopic(topic),
        messages: [
          {
            key,
            value: raw,
            headers: {
              "original-topic": topic,
              "dead-lettered-at": new Date().toISOString(),
            },
          },
        ],
      });
    } finally {
      await producer.disconnect();
    }
  }
}
