// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../../config/app-config.js";
import { IdentityRepository } from "../../features/authentication/identity.repository.js";
import { LocationRepository } from "../../features/locations/location.repository.js";
import { ModerationRepository } from "../../features/moderation/moderation.repository.js";
import { MomentRepository } from "../../features/moments/moment.repository.js";
import { MomentService } from "../../features/moments/moment.service.js";
import { NotificationDeliveryRepository } from "../../features/notifications/notification.delivery.repository.js";
import { StoredRecipientDirectory } from "../../features/notifications/notification.recipients.js";
import { NotificationRepository } from "../../features/notifications/notification.repository.js";
import { NotificationService } from "../../features/notifications/notification.service.js";
import { RealWorldEventRepository } from "../../features/real-world-events/real-world-event.repository.js";
import { FollowRepository } from "../../features/social/follow.repository.js";
import { UploadRepository } from "../../features/uploads/upload.repository.js";
import { UserRepository } from "../../features/users/user.repository.js";
import { createEmailClient } from "../../integrations/email/email-client.js";
import { createPushClient } from "../../integrations/push/push-client.js";
import { connectDatabase, createDatabase } from "../../lib/database/postgres.js";
import { dispatchDueDeliveries } from "./dispatch.js";

/**
 * The notification-dispatching worker.
 *
 * Deployed separately from the HTTP process, for the reason the outbox
 * publisher is: sending is a long-running loop whose failure and scaling
 * characteristics have nothing in common with serving requests, and an HTTP
 * process should not be kept alive because a provider is slow.
 *
 * It is also what makes `architecture/notifications.md:840` true. A reaction, a
 * Moment, a moderation decision, and a session revocation all succeed without
 * this process existing — they write a row and return. If every provider is
 * down, the rows are still there.
 *
 * Several instances may run. Deliveries are claimed with `FOR UPDATE SKIP
 * LOCKED`, so dispatchers take disjoint work rather than sending the same email
 * twice.
 *
 * It builds a Moment service and a notification service because composition
 * happens here rather than when the delivery was created: each message is built
 * from what the recipient may see at the moment it goes out, so a Moment made
 * private while an email sat in the queue means the email is not sent.
 */

/**
 * How often to look for work when there was none.
 *
 * Longer than the outbox publisher's second, because the thing being waited for
 * is different. The outbox drains messages that arrived a moment ago; this
 * drains deliveries that may have been scheduled for tomorrow morning, and
 * asking every second whether nine o'clock has arrived is a query a second for
 * nothing.
 */
const IDLE_INTERVAL_MS = 5_000;

/** How long to wait after a full batch. Nothing: there is almost certainly more. */
const BUSY_INTERVAL_MS = 0;

const BATCH_SIZE = 50;

/**
 * Run the dispatcher until asked to stop.
 *
 * @returns Nothing, once shutdown completes.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.database);
  await connectDatabase(database);

  const accounts = new UserRepository(database.dataSource);
  const email = createEmailClient(config.email);
  const push = createPushClient();

  const moments = new MomentService(
    database.dataSource,
    new MomentRepository(database.dataSource),
    new UploadRepository(database.dataSource),
    new LocationRepository(database.dataSource),
    new RealWorldEventRepository(database.dataSource),
    new FollowRepository(database.dataSource),
    accounts,
    new ModerationRepository(database.dataSource),
  );

  const notifications = new NotificationService(
    database.dataSource,
    new NotificationRepository(database.dataSource),
    moments,
    accounts,
    new FollowRepository(database.dataSource),
  );

  let running = true;

  const shutdown = async (): Promise<void> => {
    running = false;
    await email.close();
    await database.close();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  while (running) {
    const result = await dispatchDueDeliveries({
      dataSource: database.dataSource,
      deliveries: new NotificationDeliveryRepository(database.dataSource),
      notifications,
      recipients: new StoredRecipientDirectory(
        accounts,
        new IdentityRepository(database.dataSource),
      ),
      email,
      push,
      batchSize: BATCH_SIZE,
    });

    // Written only when something was given up on. A dispatcher that reported
    // every successful send would bury the one line an operator needs, and a
    // delivery nobody will ever receive is the only outcome here that wants
    // somebody to look at it.
    if (result.failed + result.abandoned > 0) {
      process.stderr.write(
        `Deliveries not sent: ${result.failed} failed, ${result.abandoned} abandoned\n`,
      );
    }

    await new Promise((resolve) =>
      setTimeout(resolve, result.reachedEnd ? IDLE_INTERVAL_MS : BUSY_INTERVAL_MS),
    );
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Notification dispatcher failed: ${String(error)}\n`);
  }
  process.exit(1);
}
