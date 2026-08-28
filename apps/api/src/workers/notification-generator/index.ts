// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../../config/app-config.js";
import { LocationRepository } from "../../features/locations/location.repository.js";
import { ModerationRepository } from "../../features/moderation/moderation.repository.js";
import { MomentCommentRepository } from "../../features/moments/moment-comment.repository.js";
import { MomentRepository } from "../../features/moments/moment.repository.js";
import { MomentService } from "../../features/moments/moment.service.js";
import { NotificationDeliveryRepository } from "../../features/notifications/notification.delivery.repository.js";
import { NotificationDeliveryService } from "../../features/notifications/notification.delivery.service.js";
import { NotificationGenerator } from "../../features/notifications/notification.generator.js";
import { StoredRecipientDirectory } from "../../features/notifications/notification.recipients.js";
import { NotificationRepository } from "../../features/notifications/notification.repository.js";
import { RealWorldEventRepository } from "../../features/real-world-events/real-world-event.repository.js";
import { FollowRepository } from "../../features/social/follow.repository.js";
import { UploadRepository } from "../../features/uploads/upload.repository.js";
import { IdentityRepository } from "../../features/authentication/identity.repository.js";
import { UserRepository } from "../../features/users/user.repository.js";
import { connectDatabase, createDatabase } from "../../lib/database/postgres.js";
import { createEventConsumer } from "../../lib/messaging/consumer.js";
import { createMessaging } from "../../lib/messaging/kafka.js";
import { topicName } from "../../lib/messaging/topics.js";
import { NOTIFICATION_GENERATOR_BOUNDARIES, notifyFromEvent } from "./generate.js";

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
    new MomentCommentRepository(database.dataSource),
  );

  const accounts = new UserRepository(database.dataSource);
  const notifications = new NotificationRepository(database.dataSource);

  const generator = new NotificationGenerator(
    database.dataSource,
    notifications,
    moments,
    // Deliveries are opened in the same transaction as the notification they
    // carry. Sending them is somebody else's job entirely: this process decides
    // that a message should go, and the dispatcher finds out whether it can.
    new NotificationDeliveryService(
      database.dataSource,
      new NotificationDeliveryRepository(database.dataSource),
      notifications,
      accounts,
      new StoredRecipientDirectory(accounts, new IdentityRepository(database.dataSource)),
    ),
  );

  const consumer = createEventConsumer({
    kafka: messaging.kafka,
    groupId: GROUP_ID,
    topics: NOTIFICATION_GENERATOR_BOUNDARIES.map((boundary) => topicName(boundary)),
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
