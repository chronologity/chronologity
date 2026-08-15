import {
  jsonEvent,
  NO_STREAM,
  STREAM_EXISTS,
  WrongExpectedVersionError,
  type AppendExpectedRevision,
  type EventStoreDBClient,
} from "@eventstore/db-client";
import type { ErrorCode } from "@chronologity/contracts";
import type { DomainEvent, EventMetadata } from "../../types/domain-event.js";
import { DomainError } from "../errors/domain-error.js";
import { generateId } from "../ids/generate-id.js";

/**
 * Raised when a stream moved since the state a decision was based on.
 *
 * This is an ordinary outcome under concurrency, not a defect: two callers
 * acted on the same version and one of them must retry against fresh state.
 * It maps to a documented, retryable error code so a client can tell the
 * difference between "try again" and "this will never work".
 */
export class ConcurrencyConflictError extends DomainError {
  override readonly code: ErrorCode = "CONCURRENCY_CONFLICT";
  override readonly status = 409;
}

/** Where a stream is expected to be when appending. */
export type ExpectedRevision = bigint | "no_stream" | "stream_exists" | "any";

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
