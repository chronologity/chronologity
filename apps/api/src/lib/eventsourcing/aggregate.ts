import type { EventStoreDBClient } from "@eventstore/db-client";
import type { DomainEvent, EventMetadata } from "../../types/domain-event.js";
import { appendEvents, type ExpectedRevision } from "../eventstore/append-events.js";
import { readStream } from "../eventstore/read-stream.js";
import { streamName } from "../eventstore/stream-name.js";

/**
 * Event-sourced aggregate conventions.
 *
 * Deliberately small. This is a convention, not a framework: it gives every
 * feature the same load/decide/append shape without dictating how a domain
 * models its own state.
 *
 * The shape is:
 *
 *     load  → current state and the revision it was derived from
 *     decide → new events, or a rejection
 *     append → persist against that same revision
 *
 * The revision travels from load to append because that is what makes the
 * concurrency check meaningful. A decision made against version 4 must not be
 * written on top of version 7.
 */

/** Rebuilds state from history. Must be pure: replay has to be deterministic. */
export type Evolve<State, Event extends DomainEvent> = (state: State, event: Event) => State;

export interface AggregateDefinition<State, Event extends DomainEvent> {
  /** The stream category, e.g. `moment`. */
  readonly category: string;
  /** State before anything has happened. */
  readonly initialState: State;
  readonly evolve: Evolve<State, Event>;
}

/** State as loaded, together with the revision it reflects. */
export interface LoadedAggregate<State> {
  readonly state: State;
  /** `no_stream` when the aggregate has no history yet. */
  readonly revision: ExpectedRevision;
  /** How many events were replayed. Useful for deciding when a snapshot would pay. */
  readonly eventCount: number;
}

export interface AggregateStore<State, Event extends DomainEvent> {
  load(aggregateId: string): Promise<LoadedAggregate<State>>;
  append(
    aggregateId: string,
    events: readonly Event[],
    metadata: EventMetadata,
    expectedRevision: ExpectedRevision,
  ): Promise<bigint>;
}

/**
 * Build a store for one aggregate type.
 *
 * Unknown event types are replayed as no-ops rather than rejected. History
 * outlives code: a stream may contain events written by a newer deployment, or
 * by a feature since removed, and refusing to load in that case would make old
 * history unreadable rather than merely unfamiliar.
 */
export function defineAggregate<State, Event extends DomainEvent>(
  definition: AggregateDefinition<State, Event>,
  client: EventStoreDBClient,
): AggregateStore<State, Event> {
  const { category, initialState, evolve } = definition;

  return {
    async load(aggregateId) {
      const recorded = await readStream(client, streamName(category, aggregateId));

      if (recorded.length === 0) {
        return { state: initialState, revision: "no_stream", eventCount: 0 };
      }

      let state = initialState;
      for (const event of recorded) {
        state = evolve(state, { type: event.type, payload: event.payload } as Event);
      }

      const last = recorded[recorded.length - 1];

      return {
        state,
        revision: last === undefined ? "no_stream" : last.revision,
        eventCount: recorded.length,
      };
    },

    async append(aggregateId, events, metadata, expectedRevision) {
      return appendEvents({
        client,
        streamName: streamName(category, aggregateId),
        events,
        metadata,
        expectedRevision,
      });
    },
  };
}
