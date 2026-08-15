import { EventStoreDBClient } from "@eventstore/db-client";
import type { EventStoreConfig } from "../../config/eventstore-config.js";
import type { HealthCheckable } from "../health.js";

/**
 * The API's EventStoreDB boundary.
 *
 * EventStoreDB holds authoritative event history. It is never queried to
 * satisfy Timeline reads (ADR-010); those are served from derived read models.
 */
export interface EventStore extends HealthCheckable {
  readonly client: EventStoreDBClient;
  close(): Promise<void>;
}

/**
 * Build the API's EventStoreDB boundary.
 *
 * @param config - The connection string.
 * @returns The client, a health check that performs a real read, and a close.
 */
export function createEventStore(config: EventStoreConfig): EventStore {
  const client = EventStoreDBClient.connectionString(config.connectionString);

  return {
    name: "eventstore",
    client,
    async checkHealth() {
      // Reading proves the connection and the node's willingness to serve
      // reads, not merely that a socket opened.
      //
      // The bounded stream is consumed to completion rather than abandoned
      // with a `break`: breaking early leaves the underlying gRPC call open,
      // and dispose() then waits on it until the shutdown timeout fires.
      const stream = client.readAll({ maxCount: 1 });
      for await (const _resolved of stream) {
        // Bounded by maxCount, so this ends on its own.
      }
    },
    async close() {
      await client.dispose();
    },
  };
}
