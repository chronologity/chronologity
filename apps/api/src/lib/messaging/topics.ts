import { ValidationError } from "../errors/validation-error.js";

/**
 * Topic naming.
 *
 * A small, intentional set of topics along stable integration boundaries —
 * not one topic per event type, which couples every consumer to the write
 * side's file layout, and not one global topic, which forces unrelated
 * domains to share partitioning and ordering.
 *
 *     chronologity.<boundary>.v<major>
 *
 * The version is part of the name because a breaking envelope change is
 * deployed by publishing to a new topic while consumers migrate, rather than
 * by reinterpreting messages already in flight.
 */

const TOPIC_PATTERN = /^chronologity\.[a-z][a-z0-9-]*\.v[1-9][0-9]*$/;

export function topicName(boundary: string, majorVersion = 1): string {
  const name = `chronologity.${boundary}.v${majorVersion}`;

  if (!TOPIC_PATTERN.test(name)) {
    throw new ValidationError("Invalid topic name", { boundary, majorVersion });
  }

  return name;
}

/**
 * The dead-letter topic for a topic.
 *
 * A message that cannot be processed after its retries is moved aside rather
 * than blocking its partition forever. Nothing is discarded: a poison message
 * is evidence of a defect, and deleting it deletes the evidence.
 */
export function deadLetterTopic(topic: string): string {
  return `${topic}.dlq`;
}

/**
 * Partition key.
 *
 * Kafka guarantees order within a partition only, so the key must be the
 * smallest boundary that genuinely requires ordering — the aggregate. Keying
 * more coarsely serialises unrelated work; more finely loses the ordering the
 * domain depends on.
 */
export function partitionKeyForAggregate(aggregateId: string): string {
  return aggregateId;
}
