import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../../config/app-config.js";
import { createDatabase } from "../../lib/database/postgres.js";
import { createEventStore } from "../../lib/eventstore/client.js";
import { createMessaging } from "../../lib/messaging/kafka.js";
import { createEventProducer } from "../../lib/messaging/producer.js";
import { publishPendingEvents } from "./publish-events.js";

/**
 * The event-publisher worker.
 *
 * Deployed separately from the HTTP process (ADR-050): publication is a
 * long-running loop whose failure and scaling characteristics have nothing in
 * common with serving requests, and an HTTP process should not be kept alive
 * merely because a publisher is mid-batch.
 *
 * Exactly one instance should run per checkpoint. Two would both read from the
 * same position and publish the same events, which consumers tolerate but which
 * doubles their work for no benefit.
 */

/** Stream categories that publish, and the boundary topic each publishes to. */
const ROUTES: Readonly<Record<string, string>> = {
  // Populated as domains arrive in Phase 5. Publication is opt-in.
};

const POLL_INTERVAL_MS = 1_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.database);
  const eventStore = createEventStore(config.eventStore);
  const messaging = createMessaging(config.messaging);
  const producer = createEventProducer(messaging.kafka);

  await producer.connect();

  let running = true;

  const shutdown = async (): Promise<void> => {
    running = false;
    await producer.disconnect();
    await messaging.close();
    await eventStore.close();
    await database.close();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  while (running) {
    const { reachedEnd } = await publishPendingEvents({
      client: eventStore.client,
      pool: database.pool,
      producer,
      routes: ROUTES,
      maxEvents: 500,
    });

    // Idle only once caught up. Sleeping because a pass published nothing
    // would stall whenever a batch happened to contain only events this
    // publisher does not route.
    if (reachedEnd) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Event publisher failed: ${String(error)}\n`);
  }
  process.exit(1);
}
