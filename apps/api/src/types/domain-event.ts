/**
 * An accepted past-tense fact, as an aggregate recorded it.
 *
 * Retained only until the last event-sourced feature is migrated; PostgreSQL is
 * the authority and there is no event store (ADR-092). What crosses a boundary
 * is an Integration Event, which a service enqueues to the outbox deliberately
 * and which carries its own contract and compatibility rules.
 */
export interface DomainEvent<Type extends string = string, Payload = unknown> {
  readonly type: Type;
  readonly payload: Payload;
}
