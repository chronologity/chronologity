// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import {
  COMMENTS_BOUNDARY,
  MODERATION_BOUNDARY,
  REACTIONS_BOUNDARY,
  SOCIAL_BOUNDARY,
} from "@chronologity/contracts";
import { loadConfig } from "../../config/app-config.js";
import { LocationRepository } from "../../features/locations/location.repository.js";
import { ModerationRepository } from "../../features/moderation/moderation.repository.js";
import { MomentRepository } from "../../features/moments/moment.repository.js";
import { MomentService } from "../../features/moments/moment.service.js";
import { NotificationGenerator } from "../../features/notifications/notification.generator.js";
import { NotificationRepository } from "../../features/notifications/notification.repository.js";
import { RealWorldEventRepository } from "../../features/real-world-events/real-world-event.repository.js";
import { FollowRepository } from "../../features/social/follow.repository.js";
import { UploadRepository } from "../../features/uploads/upload.repository.js";
import { UserRepository } from "../../features/users/user.repository.js";
import { connectDatabase, createDatabase } from "../../lib/database/postgres.js";
import { createEventConsumer } from "../../lib/messaging/consumer.js";
import { createMessaging } from "../../lib/messaging/kafka.js";
import { topicName } from "../../lib/messaging/topics.js";
import { notifyFromEvent } from "./generate.js";

/**
 * The notification-generating worker.
 *
 * Its own consumer group, canonical in `messaging.md` alongside the search
 * indexer. Notifications lagging must never hold up indexing, and indexing
 * lagging must never hold up notifications — somebody waiting to hear that
 * their upload failed should not be waiting on a search backlog.
 *
 * Nothing authoritative depends on this process. A reaction is recorded whether
 * or not anybody is told about it, and if this is down for an hour the only
 * consequence is that notifications arrive an hour late.
 *
 * It builds a Moment service because eligibility is the Moment visibility rule
 * and reusing it is the point: a notification is one of the easiest ways to
 * tell somebody that a Moment exists, so "may they see it" has to be the same
 * question here as everywhere else.
 */

const GROUP_ID = "notification-generator";

/**
 * Run the generator until asked to stop.
 *
 * @returns Nothing, once shutdown completes.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.database);
  await connectDatabase(database);
  const messaging = createMessaging(config.messaging);

  const moments = new MomentService(
    database.dataSource,
    new MomentRepository(database.dataSource),
    new UploadRepository(database.dataSource),
    new LocationRepository(database.dataSource),
    new RealWorldEventRepository(database.dataSource),
    new FollowRepository(database.dataSource),
    new UserRepository(database.dataSource),
    new ModerationRepository(database.dataSource),
  );

  const generator = new NotificationGenerator(
    database.dataSource,
    new NotificationRepository(database.dataSource),
    moments,
  );

  const consumer = createEventConsumer({
    kafka: messaging.kafka,
    groupId: GROUP_ID,
    topics: [
      topicName(REACTIONS_BOUNDARY),
      topicName(COMMENTS_BOUNDARY),
      topicName(SOCIAL_BOUNDARY),
      topicName(MODERATION_BOUNDARY),
    ],
    handler: (event) => notifyFromEvent(generator, event),
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
    process.stderr.write(`Notification generator failed: ${String(error)}\n`);
  }
  process.exit(1);
}
