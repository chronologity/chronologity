/**
 * Metadata recorded alongside every Integration Event.
 *
 * Correlation and causation are recorded at write time because they cannot be
 * reconstructed later: once a message is written, the reason it was written is
 * either in its metadata or gone.
 *
 * This travels in the outbox row's `metadata` column and again in the Kafka
 * envelope, which is what lets a trace follow a change from the request that
 * caused it, through the broker, into whatever acts on it.
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
