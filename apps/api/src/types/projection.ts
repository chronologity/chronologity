import type { EventMetadata } from "./event-metadata.js";

/** A persisted event as a projection receives it. */
export interface ProjectionEvent<Payload = unknown> {
  readonly streamName: string;
  readonly type: string;
  readonly payload: Payload;
  readonly metadata: EventMetadata;
  /** Global position, used to record progress and to detect replays. */
  readonly position: bigint;
  readonly revision: bigint;
}

/**
 * Derives read state from authoritative history.
 *
 * Projections are disposable (ADR-017): anything a projection knows must be
 * reconstructible by replaying events, so a projection may be rebuilt at any
 * time without consulting its own prior output.
 */
export interface Projection {
  /** Identifies both the projection and its version, e.g. `timeline-v1`. */
  readonly name: string;
  /**
   * Apply one event.
   *
   * Must be idempotent: at-least-once delivery means an event will eventually
   * be applied twice, and a projection that double-counts is a projection that
   * silently disagrees with history.
   */
  apply(event: ProjectionEvent): Promise<void>;
}
