import type { EventStoreDBClient } from "@eventstore/db-client";
import type pg from "pg";
import type { EventMetadata } from "../../types/domain-event.js";
import type { Projection, ProjectionEvent } from "../../types/projection.js";
import { withTransaction } from "../database/transaction.js";
import type { Logger } from "../logger/logger.js";
import {
  claimEvent,
  readCheckpoint,
  resetProjection,
  writeCheckpoint,
} from "./checkpoint-store.js";

/**
 * Running a projection over authoritative history.
 *
 * The loop is deliberately boring: read from the last checkpoint, apply each
 * event once, record progress in the same transaction as the effect. What it
 * buys is that a projection can be stopped at any point and resumed without
 * either losing an event or applying one twice.
 *
 * Reading from EventStoreDB rather than Kafka makes rebuild possible: Kafka
 * retains messages for a window, while authoritative history retains
 * everything. A projection that could only be built from Kafka would be
 * rebuildable only as far back as its retention policy (ADR-017).
 */

export interface RunProjectionOptions {
  readonly projection: Projection;
  readonly client: EventStoreDBClient;
  readonly pool: pg.Pool;
  readonly logger?: Logger;
  /** Stop after this many events. Absent means read to the end of history. */
  readonly maxEvents?: number;
}

export interface ProjectionRunResult {
  readonly applied: number;
  readonly skipped: number;
  readonly position: bigint | undefined;
}

const SOURCE = "eventstoredb:$all";

/**
 * Process everything the projection has not yet seen, then return.
 *
 * A single pass rather than a daemon: the caller decides whether this runs once
 * in a rebuild job or repeatedly in a worker, and a function that returns is far
 * easier to test than one that never does.
 *
 * @param options - The projection, where to read from, where to record progress,
 *   an optional logger, and an optional cap on how many events one pass reads.
 * @returns How many events were applied, how many were recognised as already
 *   applied, and the position reached.
 */
export async function runProjection({
  projection,
  client,
  pool,
  logger,
  maxEvents,
}: RunProjectionOptions): Promise<ProjectionRunResult> {
  const checkpoint = await readCheckpoint(pool, projection.name);
  const fromPosition = checkpoint?.position;

  let applied = 0;
  let skipped = 0;
  let position = fromPosition;

  const stream = client.readAll({
    direction: "forwards",
    fromPosition:
      fromPosition === undefined ? "start" : { commit: fromPosition, prepare: fromPosition },
    ...(maxEvents === undefined ? {} : { maxCount: maxEvents }),
  });

  for await (const resolved of stream) {
    const event = resolved.event;

    if (event === undefined) {
      continue;
    }

    // System streams describe EventStoreDB's own bookkeeping, not domain history.
    if (event.type.startsWith("$") || event.streamId.startsWith("$")) {
      continue;
    }

    const commitPosition = resolved.commitPosition ?? event.position?.commit;

    if (commitPosition === undefined) {
      continue;
    }

    // Resuming from a stored position re-reads the event at that position, so
    // the first event of a resumed run is one already applied.
    if (fromPosition !== undefined && commitPosition <= fromPosition) {
      continue;
    }

    const projectionEvent: ProjectionEvent = {
      streamName: event.streamId,
      type: event.type,
      payload: event.data,
      metadata: event.metadata as unknown as EventMetadata,
      position: commitPosition,
      revision: event.revision,
    };

    await withTransaction(pool, async (tx) => {
      const claimed = await claimEvent(tx, projection.name, event.id);

      if (!claimed) {
        // Already applied on an earlier delivery. Advancing the checkpoint is
        // still correct and stops the same event being reconsidered forever.
        skipped += 1;
        await writeCheckpoint(tx, projection.name, SOURCE, commitPosition);
        return;
      }

      await projection.apply(projectionEvent);
      await writeCheckpoint(tx, projection.name, SOURCE, commitPosition);
      applied += 1;
    });

    position = commitPosition;
  }

  logger?.info({ projection: projection.name, applied, skipped }, "Projection pass complete");

  return { applied, skipped, position };
}

/**
 * Rebuild a projection from the beginning.
 *
 * Discarding progress is the caller's decision and happens in its own
 * transaction, so a rebuild that fails partway leaves a projection that resumes
 * from where the rebuild reached rather than one stuck between two versions.
 *
 * @param options - As for {@link runProjection}.
 * @returns The result of the rebuilding pass. Progress is discarded in its own
 *   transaction first, so a rebuild that fails partway leaves a projection that
 *   resumes from where it reached rather than one stuck between two versions.
 */
export async function rebuildProjection(
  options: RunProjectionOptions,
): Promise<ProjectionRunResult> {
  await withTransaction(options.pool, async (tx) => {
    await resetProjection(tx, options.projection.name);
  });

  options.logger?.info({ projection: options.projection.name }, "Rebuilding projection");

  return runProjection(options);
}
