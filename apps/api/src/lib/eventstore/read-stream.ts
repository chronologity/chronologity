import { StreamNotFoundError, type EventStoreDBClient } from "@eventstore/db-client";
import type { EventMetadata } from "../../types/domain-event.js";

/** One persisted event, as read back from a stream. */
export interface RecordedEvent<Payload = unknown> {
  readonly type: string;
  readonly payload: Payload;
  readonly metadata: EventMetadata;
  readonly revision: bigint;
}

/**
 * Read a stream from the beginning.
 *
 * A missing stream yields an empty list rather than throwing: to an aggregate,
 * "no history" and "nothing happened yet" are the same state, and forcing every
 * caller to catch a not-found error invites some of them to catch too much.
 *
 * The stream is consumed to completion rather than abandoned partway, so no
 * gRPC call is left open. An early `break` here is what made shutdown hang
 * during Phase 3.
 *
 * @param client - The event store to read from.
 * @param streamName - Which stream.
 * @returns Its events in order, or an empty list if the stream does not exist.
 */
export async function readStream<Payload = unknown>(
  client: EventStoreDBClient,
  streamName: string,
): Promise<RecordedEvent<Payload>[]> {
  const events: RecordedEvent<Payload>[] = [];

  try {
    for await (const resolved of client.readStream(streamName, { direction: "forwards" })) {
      const event = resolved.event;

      if (event === undefined) {
        continue;
      }

      events.push({
        type: event.type,
        payload: event.data as Payload,
        metadata: event.metadata as unknown as EventMetadata,
        revision: event.revision,
      });
    }
  } catch (error) {
    if (error instanceof StreamNotFoundError) {
      return [];
    }

    throw error;
  }

  return events;
}
