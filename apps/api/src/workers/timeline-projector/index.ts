// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../../config/app-config.js";
import { TimelineProjector } from "../../features/timeline/timeline.projector.js";
import { TimelineRepository } from "../../features/timeline/timeline.repository.js";
import { TimelineSourceRepository } from "../../features/timeline/timeline-source.repository.js";
import { createAnalytics } from "../../lib/clickhouse/clickhouse.js";
import { connectDatabase, createDatabase } from "../../lib/database/postgres.js";
import { createEventConsumer } from "../../lib/messaging/consumer.js";
import { createMessaging } from "../../lib/messaging/kafka.js";
import { topicName } from "../../lib/messaging/topics.js";
import { projectFromEvent, TIMELINE_PROJECTOR_BOUNDARIES } from "./project-timeline.js";

/**
 * The Timeline projection worker.
 *
 * Its own consumer group, so Timeline lag never blocks Search indexing or
 * notification generation and neither blocks it. Several instances may run at
 * once: the broker divides the partitions, Moment events are keyed by Moment,
 * and projecting one Moment twice leaves what projecting it once did.
 *
 * Nothing authoritative depends on this process. A Moment is recorded whether
 * or not the Timeline knows yet, and everything it writes can be rebuilt from
 * PostgreSQL — which is what makes losing ClickHouse an availability problem
 * rather than a loss of history (ADR-055).
 */

const GROUP_ID = "timeline-projector";

/**
 * Run the projector until asked to stop.
 *
 * @returns Nothing, once shutdown completes.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.database);
  await connectDatabase(database);
  const analytics = createAnalytics(config.clickhouse);
  const messaging = createMessaging(config.messaging);

  const projector = new TimelineProjector(
    database.dataSource,
    new TimelineRepository(analytics.client),
    new TimelineSourceRepository(database.dataSource),
  );

  const consumer = createEventConsumer({
    kafka: messaging.kafka,
    groupId: GROUP_ID,
    topics: TIMELINE_PROJECTOR_BOUNDARIES.map((boundary) => topicName(boundary)),
    handler: (event) => projectFromEvent(projector, event),
  });

  const shutdown = async (): Promise<void> => {
    await consumer.stop();
    await messaging.close();
    await analytics.close();
    await database.close();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  await consumer.start();
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Timeline projector failed: ${String(error)}\n`);
  }
  process.exit(1);
}
