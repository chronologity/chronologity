import {
  jsonEvent,
  NO_STREAM,
  STREAM_EXISTS,
  WrongExpectedVersionError,
  type AppendExpectedRevision,
  type EventStoreDBClient,
} from "@eventstore/db-client";
import type { DomainEvent } from "../../types/domain-event.js";
import type { EventMetadata } from "../../types/event-metadata.js";
import { ConcurrencyConflictError } from "../errors/concurrency-conflict-error.js";
import { generateId } from "../ids/generate-id.js";

/** Where a stream is expected to be when appending. */
export type ExpectedRevision = bigint | "no_stream" | "stream_exists" | "any";

/**
 * Translate an expected revision into the client's representation.
 *
 * @param expected - The revision the decision was made against.
 * @returns The equivalent value for the event-store client.
 */
function toClientRevision(expected: ExpectedRevision): AppendExpectedRevision {
  if (expected === "no_stream") return NO_STREAM;
  if (expected === "stream_exists") return STREAM_EXISTS;
  if (expected === "any") return "any";
  return expected;
}

export interface AppendOptions {
  client: EventStoreDBClient;
  streamName: string;
  events: readonly DomainEvent[];
  metadata: EventMetadata;
  /**
   * The revision the decision was made against.
   *
   * Required rather than optional. Defaulting this to "any" would turn every
   * unconsidered append into a lost update, and the caller always knows the
   * revision it loaded.
   */
  expectedRevision: ExpectedRevision;
}

/**
 * Append events to a stream under optimistic concurrency.
 *
 * Each event carries its own identifier, which is what makes a retried append
 * detectable rather than silently duplicated.
 *
 * @param options - The client, the stream, the events, the metadata to record
 *   alongside them, and the revision the decision was made against.
 * @returns The stream's revision after the append.
 * @throws {ConcurrencyConflictError} If the stream moved since that revision.
 * @throws {Error} If asked to append nothing, which is always a caller mistake.
 */
export async function appendEvents({
  client,
  streamName,
  events,
  metadata,
  expectedRevision,
}: AppendOptions): Promise<bigint> {
  if (events.length === 0) {
    throw new Error("Refusing to append an empty event list");
  }

  const prepared = events.map((event) =>
    jsonEvent({
      id: generateId(),
      type: event.type,
      data: event.payload as Record<string, unknown>,
      metadata: { ...metadata },
    }),
  );

  try {
    const result = await client.appendToStream(streamName, prepared, {
      expectedRevision: toClientRevision(expectedRevision),
    });

    return result.nextExpectedRevision;
  } catch (error) {
    if (error instanceof WrongExpectedVersionError) {
      throw new ConcurrencyConflictError(
        "The stream changed while this operation was being processed",
        { streamName },
      );
    }

    throw error;
  }
}
