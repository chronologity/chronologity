/**
 * An accepted past-tense fact.
 *
 * Domain events are the aggregate's own record of what happened. They are
 * persisted to EventStoreDB and are not the same thing as the integration
 * events published to Kafka, which are a boundary contract with their own
 * compatibility rules.
 */
export interface DomainEvent<Type extends string = string, Payload = unknown> {
  readonly type: Type;
  readonly payload: Payload;
}

/**
 * Metadata stored alongside every persisted event.
 *
 * Correlation and causation are recorded at write time because they cannot be
 * reconstructed later: once history is written, the reason it was written is
 * either in the metadata or gone.
 */
export interface EventMetadata {
  readonly traceId: string;
  readonly correlationId: string | undefined;
  readonly causationId: string | undefined;
  readonly actorUserId: string | undefined;
  /** Contract version of this event's payload, for upcasting on read. */
  readonly eventVersion: number;
  readonly recordedAt: string;
}
