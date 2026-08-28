// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../../config/app-config.js";
import { SearchIndexer } from "../../features/search/search.indexer.js";
import { SearchRepository } from "../../features/search/search.repository.js";
import { SearchSourceRepository } from "../../features/search/search-source.repository.js";
import { connectDatabase, createDatabase } from "../../lib/database/postgres.js";
import { createEventConsumer } from "../../lib/messaging/consumer.js";
import { createMessaging } from "../../lib/messaging/kafka.js";
import { topicName } from "../../lib/messaging/topics.js";
import { indexFromEvent, SEARCH_INDEXER_BOUNDARIES } from "./index-event.js";

/**
 * The Search indexing worker.
 *
 * Keeps derived state current. Nothing authoritative depends on it: a Moment is
 * recorded successfully whether or not it is searchable yet, and if this
 * process is down for an hour the only consequence is that Search is an hour
 * behind.
 *
 * Its own consumer group, so Search lag never blocks Timeline projection or
 * notification generation and neither blocks Search. Several instances may run
 * at once; the broker divides the partitions, and indexing one entity twice
 * produces one document.
 *
 * It subscribes to every domain topic rather than one, because a document is
 * built from several tables and any of them changing can change it.
 */

const GROUP_ID = "search-indexer";

/**
 * Run the indexer until asked to stop.
 *
 * @returns Nothing, once shutdown completes.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.database);
  await connectDatabase(database);
  const messaging = createMessaging(config.messaging);

  const indexer = new SearchIndexer(
    database.dataSource,
    new SearchRepository(database.dataSource),
    new SearchSourceRepository(database.dataSource),
  );

  const consumer = createEventConsumer({
    kafka: messaging.kafka,
    groupId: GROUP_ID,
    topics: SEARCH_INDEXER_BOUNDARIES.map((boundary) => topicName(boundary)),
    handler: (event) => indexFromEvent(indexer, event),
  });

  const shutdown = async (): Promise<void> => {
    await consumer.stop();
    await messaging.close();
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
    process.stderr.write(`Search indexer failed: ${String(error)}\n`);
  }
  process.exit(1);
}
