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
import { IdentityRepository } from "../../features/authentication/identity.repository.js";
import { NotificationDeliveryRepository } from "../../features/notifications/notification.delivery.repository.js";
import { NotificationDeliveryService } from "../../features/notifications/notification.delivery.service.js";
import { NotificationGenerator } from "../../features/notifications/notification.generator.js";
import { StoredRecipientDirectory } from "../../features/notifications/notification.recipients.js";
import { NotificationRepository } from "../../features/notifications/notification.repository.js";
import { RealWorldEventRepository } from "../../features/real-world-events/real-world-event.repository.js";
import { SavedViewRepository } from "../../features/saved-views/saved-view.repository.js";
import { FollowRepository } from "../../features/social/follow.repository.js";
import { UploadRepository } from "../../features/uploads/upload.repository.js";
import { UserRepository } from "../../features/users/user.repository.js";
import { TimelineEligibilityResolver } from "../../features/timeline/timeline.eligibility.js";
import { TimelineReadRepository } from "../../features/timeline/timeline.read.repository.js";
import { TimelineService } from "../../features/timeline/timeline.service.js";
import { createAnalytics } from "../../lib/clickhouse/clickhouse.js";
import { connectDatabase, createDatabase } from "../../lib/database/postgres.js";
import { MAXIMUM_AGE_MS } from "../../features/saved-views/saved-view-awareness.js";
import { recountAwareness } from "./recount-awareness.js";

/**
 * The saved-view awareness worker.
 *
 * Counts what each saved view has gained since its owner last looked, stalest
 * first, forever. It exists because the alternative was measured and rejected:
 * counting on the read path cost about a second for a list of ten views before
 * any authorisation was resolved (ADR-132), which is not a cost a list may
 * carry.
 *
 * **Both stores.** Unlike the significance sweep it reads the ClickHouse
 * projection as well as PostgreSQL, because what a view holds is a Timeline
 * derivation and reproducing it against the authoritative tables would be a
 * second query system beside the one that already exists.
 *
 * **If it is down, nothing is disclosed.** Counts carry the instant they were
 * taken and the presenter refuses to show one past its budget, so an outage
 * makes badges disappear rather than go stale. That is the property that lets
 * the privacy argument stand without assuming this process is running.
 */

/**
 * How long to wait after a pass that found less than a full batch.
 *
 * Nothing is owed to anybody here: a count is a hint, and one arriving a minute
 * later costs a badge a minute of accuracy on a Timeline measured in decades.
 */
const IDLE_INTERVAL_MS = 60_000;

/** How long to wait between full batches, so a sweep does not monopolise either store. */
const BUSY_INTERVAL_MS = 1_000;

/**
 * How many views one pass recounts.
 *
 * Smaller than the significance sweep's hundred because each view costs a
 * ClickHouse query rather than a handful of relational reads.
 *
 * **The cycle time this implies has to stay inside the freshness budget.** At
 * twenty-five a second, a hundred thousand saved views come round in about an
 * hour and a quarter — comfortably inside the six-hour budget. Should that stop
 * being true, badges would blank rather than go stale, which is the safe way
 * for this to fail but is still a failure worth noticing.
 */
const BATCH_SIZE = 25;

/**
 * Run the worker until asked to stop.
 *
 * @returns Nothing, once shutdown completes.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.database);
  const analytics = createAnalytics(config.clickhouse);

  await connectDatabase(database);

  const savedViews = new SavedViewRepository(database.dataSource);
  const accounts = new UserRepository(database.dataSource);
  const notifications = new NotificationRepository(database.dataSource);

  // Built here rather than shared, as every worker builds its own. The sweep is
  // the first thing in this system to raise a notification from a *derivation*
  // rather than from a message — nothing publishes "a saved view grew", because
  // nothing happened to publish.
  const notify = new NotificationGenerator(
    database.dataSource,
    notifications,
    new MomentService(
      database.dataSource,
      new MomentRepository(database.dataSource),
      new UploadRepository(database.dataSource),
      new LocationRepository(database.dataSource),
      new RealWorldEventRepository(database.dataSource),
      new FollowRepository(database.dataSource),
      accounts,
      new ModerationRepository(database.dataSource),
      new MomentCommentRepository(database.dataSource),
    ),
    new NotificationDeliveryService(
      database.dataSource,
      new NotificationDeliveryRepository(database.dataSource),
      notifications,
      accounts,
      new StoredRecipientDirectory(accounts, new IdentityRepository(database.dataSource)),
    ),
  );
  const timeline = new TimelineService(
    new TimelineReadRepository(analytics.client, config.clickhouse.projectionVersion),
    new TimelineEligibilityResolver(database.dataSource),
  );

  let running = true;

  const shutdown = async (): Promise<void> => {
    running = false;
    await analytics.close();
    await database.close();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  // Said once at startup rather than worked out from the logs later: the two
  // numbers have to stay in this relationship for a badge to mean anything.
  process.stdout.write(
    `Recounting saved views ${BATCH_SIZE} at a time; counts expire after ${MAXIMUM_AGE_MS / 3_600_000}h\n`,
  );

  while (running) {
    const { reachedEnd } = await recountAwareness({
      dataSource: database.dataSource,
      savedViews,
      timeline,
      notify,
      batchSize: BATCH_SIZE,
    });

    await new Promise((resolve) =>
      setTimeout(resolve, reachedEnd ? IDLE_INTERVAL_MS : BUSY_INTERVAL_MS),
    );
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Saved-view awareness worker failed: ${String(error)}\n`);
  }
  process.exit(1);
}
