// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../../config/app-config.js";
import { UploadRepository } from "../../features/uploads/upload.repository.js";
import { UploadService } from "../../features/uploads/upload.service.js";
import { connectDatabase, createDatabase } from "../../lib/database/postgres.js";
import { createEventConsumer } from "../../lib/messaging/consumer.js";
import { createMessaging } from "../../lib/messaging/kafka.js";
import { topicName } from "../../lib/messaging/topics.js";
import { createDerivativeClient } from "../../integrations/metadata/derivative-client.js";
import { createMetadataClient } from "../../integrations/metadata/metadata-client.js";
import { createStorageClient } from "../../integrations/storage/storage-client.js";
import { checkArrivedMedia, MEDIA_CHECKER_BOUNDARIES } from "./check-media.js";

/**
 * The media-checking worker.
 *
 * Deployed separately from the HTTP process, because opening a file takes
 * seconds and nobody should wait on that while uploading. The upload finishes
 * immediately, the file sits unverified, and this picks it up.
 *
 * Unlike the event publisher, several of these may run at once. Work arrives
 * through a consumer group, so the broker divides it, and checking the same
 * file twice is harmless — the second attempt finds it already settled.
 *
 * This process needs ffprobe on its PATH. In a container that means installing
 * it in the image; the decoder is deliberately not bundled as a dependency,
 * because it is pointed at files strangers upload and should be a version the
 * operating system keeps patched.
 */

const GROUP_ID = "media-checker";

/**
 * Run the checker until asked to stop.
 *
 * @returns Nothing, once shutdown completes.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.database);
  await connectDatabase(database);
  const messaging = createMessaging(config.messaging);
  const storage = createStorageClient(config.storage);
  const metadata = createMetadataClient();

  const uploads = new UploadService(
    database.dataSource,
    new UploadRepository(database.dataSource),
    storage,
    config.uploadLimits,
    { metadata, derivatives: createDerivativeClient() },
  );

  const consumer = createEventConsumer({
    kafka: messaging.kafka,
    groupId: GROUP_ID,
    topics: MEDIA_CHECKER_BOUNDARIES.map((boundary) => topicName(boundary)),
    handler: (event) => checkArrivedMedia(uploads, event),
  });

  const shutdown = async (): Promise<void> => {
    await consumer.stop();
    await messaging.close();
    storage.close();
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
    process.stderr.write(`Media checker failed: ${String(error)}\n`);
  }
  process.exit(1);
}
