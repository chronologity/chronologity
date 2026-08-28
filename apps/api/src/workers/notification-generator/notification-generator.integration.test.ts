import assert from "node:assert/strict";
import { testContext } from "../../testing/context.js";
import { afterAll, beforeAll, describe, it } from "vitest";
import { LocationRepository } from "../../features/locations/location.repository.js";
import { ModerationRepository } from "../../features/moderation/moderation.repository.js";
import { MomentCommentRepository } from "../../features/moments/moment-comment.repository.js";
import { MomentReactionRepository } from "../../features/moments/moment-reaction.repository.js";
import { MomentReactionService } from "../../features/moments/moment-reaction.service.js";
import { MomentRepository } from "../../features/moments/moment.repository.js";
import { MomentService } from "../../features/moments/moment.service.js";
import { NotificationGenerator } from "../../features/notifications/notification.generator.js";
import { NotificationRepository } from "../../features/notifications/notification.repository.js";
import { RealWorldEventRepository } from "../../features/real-world-events/real-world-event.repository.js";
import { FollowRepository } from "../../features/social/follow.repository.js";
import { UploadRepository } from "../../features/uploads/upload.repository.js";
import { UserRepository } from "../../features/users/user.repository.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { deliverThroughBroker } from "../../testing/broker.js";
import { createReadyUpload, createUser } from "../../testing/fixtures.js";
import { NOTIFICATION_GENERATOR_BOUNDARIES, notifyFromEvent } from "./generate.js";

/**
 * The notification generator, reached the way the deployed process reaches it.
 *
 * Everything else about this worker is proven by handing events to
 * `notifyFromEvent` directly, which is fast and tests the decisions. It is also
 * blind to the one failure this worker is most exposed to: 5Q-2 added a fifth
 * subscription, and a wrong or forgotten topic name there would have passed
 * every test in the repository while notifying nobody.
 *
 * The boundaries here come from the worker's own exported list — the same list
 * `index.ts` subscribes with — so the test and the process cannot drift apart.
 *
 * Requires `pnpm infra:up`.
 */

describe("a reaction reaching the notification generator over Kafka", () => {
  let database: Database;
  let moments: MomentService;
  let reactions: MomentReactionService;
  let generator: NotificationGenerator;

  beforeAll(async () => {
    database = createDatabase({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      database: process.env.POSTGRES_DATABASE ?? "chronologity",
      user: process.env.POSTGRES_USER ?? "chronologity",
      password: process.env.POSTGRES_PASSWORD ?? "chronologity",
    });
    await connectDatabase(database);
    await migrate(database.dataSource);

    moments = new MomentService(
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

    reactions = new MomentReactionService(
      database.dataSource,
      new MomentReactionRepository(database.dataSource),
      new MomentRepository(database.dataSource),
      moments,
      new FollowRepository(database.dataSource),
    );

    // No delivery service. What is under test is whether the message arrives
    // and produces a notification; whether an email follows is 5Q-2's subject
    // and has its own suite.
    generator = new NotificationGenerator(
      database.dataSource,
      new NotificationRepository(database.dataSource),
      moments,
    );
  });

  afterAll(async () => {
    await database.close();
  });

  it("tells the author, having travelled outbox, broker, and worker", async () => {
    const author = await createUser(database.dataSource);
    const admirer = await createUser(database.dataSource);
    const uploadId = await createReadyUpload(database.dataSource, author.userId);

    const moment = await moments.record(author.userId, {
      caption: "Somebody will react to this",
      occurrence: {
        start: "2004-07-01T00:00:00.000Z",
        end: "2004-07-31T23:59:59.000Z",
        precision: "month",
      },
      occurrenceOffsetMinutes: 0,
      uploadIds: [uploadId],
      visibility: "public",
      locationDisclosure: "exact",
    }, testContext());

    await reactions.react(moment.momentId, admirer.userId, "loved");

    const delivered = await deliverThroughBroker({
      dataSource: database.dataSource,
      boundaries: NOTIFICATION_GENERATOR_BOUNDARIES,
      aggregateId: moment.momentId,
      handler: (event) => notifyFromEvent(generator, event),
      clientId: "notification-generator-broker",
    });

    const rows: { type: string; recipient_user_id: string }[] = await database.dataSource.query(
      `SELECT type, recipient_user_id FROM notifications
        WHERE source_id = $1 AND source_type = 'moment'`,
      [moment.momentId],
    );

    assert.ok(delivered > 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.type, "moment_reacted");
    assert.equal(rows[0]?.recipient_user_id, author.userId);
  });

  it("hears nothing published to a boundary it does not subscribe to", async () => {
    // The negative that makes the test above mean something. A Moment being
    // recorded is announced on the Moments boundary, which this worker
    // deliberately ignores; watching its own five boundaries for that same
    // Moment must find nothing. Without this, a test that subscribed to every
    // topic would look identical to one that subscribed correctly.
    const author = await createUser(database.dataSource);
    const uploadId = await createReadyUpload(database.dataSource, author.userId);

    const moment = await moments.record(author.userId, {
      caption: "Recorded, and reacted to by nobody",
      occurrence: {
        start: "2005-07-01T00:00:00.000Z",
        end: "2005-07-31T23:59:59.000Z",
        precision: "month",
      },
      occurrenceOffsetMinutes: 0,
      uploadIds: [uploadId],
      visibility: "public",
      locationDisclosure: "exact",
    }, testContext());

    await assert.rejects(
      () =>
        deliverThroughBroker({
          dataSource: database.dataSource,
          boundaries: NOTIFICATION_GENERATOR_BOUNDARIES,
          aggregateId: moment.momentId,
          handler: (event) => notifyFromEvent(generator, event),
          clientId: "notification-generator-boundary-negative",
          timeoutMs: 10_000,
        }),
      /Nothing about/,
    );

    const rows: { count: number }[] = await database.dataSource.query(
      "SELECT COUNT(*)::int AS count FROM notifications WHERE source_id = $1",
      [moment.momentId],
    );

    assert.equal(rows[0]?.count, 0);
  });
});
