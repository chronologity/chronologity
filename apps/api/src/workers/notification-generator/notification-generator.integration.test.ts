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
import { createLocation, createReadyUpload, createUser } from "../../testing/fixtures.js";
import { withTransaction } from "../../lib/database/transaction.js";
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
    // The negative that makes the test above mean something: without it, a
    // worker subscribed to every topic would look identical to one subscribed
    // correctly.
    //
    // It used to watch for a Moment being recorded, which this worker ignored.
    // It no longer does — a Moment arriving at a followed place is exactly what
    // the fan-out exists for — so the negative moved to a Location being
    // recorded, which is announced on a boundary nothing here reads.
    const author = await createUser(database.dataSource);
    const locationId = await createLocation(database.dataSource, author.userId);

    await assert.rejects(
      () =>
        deliverThroughBroker({
          dataSource: database.dataSource,
          boundaries: NOTIFICATION_GENERATOR_BOUNDARIES,
          aggregateId: locationId,
          handler: (event) => notifyFromEvent(generator, event),
          clientId: "notification-generator-boundary-negative",
          timeoutMs: 10_000,
        }),
      /Nothing about/,
    );

    const rows: { count: number }[] = await database.dataSource.query(
      "SELECT COUNT(*)::int AS count FROM notifications WHERE source_id = $1",
      [locationId],
    );

    assert.equal(rows[0]?.count, 0);
  });
});

describe("a Moment arriving where somebody is watching", () => {
  let database: Database;
  let moments: MomentService;
  let momentRepository: MomentRepository;
  let follows: FollowRepository;
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

    momentRepository = new MomentRepository(database.dataSource);
    follows = new FollowRepository(database.dataSource);

    moments = new MomentService(
      database.dataSource,
      momentRepository,
      new UploadRepository(database.dataSource),
      new LocationRepository(database.dataSource),
      new RealWorldEventRepository(database.dataSource),
      follows,
      new UserRepository(database.dataSource),
      new ModerationRepository(database.dataSource),
      new MomentCommentRepository(database.dataSource),
    );

    // No delivery service, as the suite above does without one: what is under
    // test is who is told, not how a message reaches them.
    generator = new NotificationGenerator(
      database.dataSource,
      new NotificationRepository(database.dataSource),
      moments,
    );
  });

  afterAll(async () => {
    await database.close();
  });

  const fanOut = {
    contextsOf: (momentId: string) => momentRepository.contextsOf(momentId),
    followersOf: (
      context: { type: "location"; id: string } | { type: "real_world_event"; id: string },
      limit: number,
      after?: string,
    ) => follows.followersOf(context, limit, after),
  };

  const told = async (userId: string) => {
    const rows: { type: string; source_id: string }[] = await database.dataSource.query(
      `SELECT type, source_id FROM notifications
        WHERE recipient_user_id = $1 AND type = 'location_expanded'`,
      [userId],
    );

    return rows;
  };

  const recordAt = async (
    author: { userId: string },
    locationId: string,
    visibility: "public" | "private",
  ) => {
    const uploadId = await createReadyUpload(database.dataSource, author.userId);

    return moments.record(
      author.userId,
      {
        caption: "Something that happened there",
        occurrence: { start: "1998-06-01T00:00:00.000Z", end: "1998-06-01T00:00:00.000Z", precision: "day" },
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
        visibility,
        locationId,
        locationDisclosure: "exact",
      },
      testContext(),
    );
  };

  it("tells somebody following the place, and not the author", async () => {
    const author = await createUser(database.dataSource);
    const watcher = await createUser(database.dataSource);
    const locationId = await createLocation(database.dataSource, author.userId);

    await withTransaction(database.dataSource, (tx) =>
      follows.followLocation(tx, watcher.userId, locationId, new Date()),
    );
    await withTransaction(database.dataSource, (tx) =>
      follows.followLocation(tx, author.userId, locationId, new Date()),
    );

    const moment = await recordAt(author, locationId, "public");

    await deliverThroughBroker({
      dataSource: database.dataSource,
      boundaries: NOTIFICATION_GENERATOR_BOUNDARIES,
      aggregateId: moment.momentId,
      handler: (event) => notifyFromEvent(generator, event, undefined, fanOut),
      clientId: "fan-out-broker",
    });

    const theirs = await told(watcher.userId);

    assert.equal(theirs.length, 1, "somebody following the place was not told");
    assert.equal(theirs[0]?.source_id, locationId, "the notification pointed at the wrong thing");
    assert.deepEqual(await told(author.userId), [], "the author was told about their own Moment");
  });

  it("does not tell a follower about a Moment they may not see", async () => {
    // The property that matters. A place is public; what is recorded there need
    // not be, and a notification is one of the easiest ways to tell somebody
    // that a Moment exists.
    const author = await createUser(database.dataSource);
    const watcher = await createUser(database.dataSource);
    const locationId = await createLocation(database.dataSource, author.userId);

    await withTransaction(database.dataSource, (tx) =>
      follows.followLocation(tx, watcher.userId, locationId, new Date()),
    );

    const moment = await recordAt(author, locationId, "private");

    await deliverThroughBroker({
      dataSource: database.dataSource,
      boundaries: NOTIFICATION_GENERATOR_BOUNDARIES,
      aggregateId: moment.momentId,
      handler: (event) => notifyFromEvent(generator, event, undefined, fanOut),
      clientId: "fan-out-broker",
    });

    assert.deepEqual(
      await told(watcher.userId),
      [],
      "a private Moment was announced to somebody who may not read it",
    );
  });

  it("tells nobody twice when the same message arrives again", async () => {
    // The ledger is keyed on the event and the recipient, so a redelivery — or
    // a crash halfway through a large place — re-runs the whole fan-out and
    // skips whoever was already told.
    const author = await createUser(database.dataSource);
    const watcher = await createUser(database.dataSource);
    const locationId = await createLocation(database.dataSource, author.userId);

    await withTransaction(database.dataSource, (tx) =>
      follows.followLocation(tx, watcher.userId, locationId, new Date()),
    );

    const moment = await recordAt(author, locationId, "public");
    const deliver = () =>
      deliverThroughBroker({
        dataSource: database.dataSource,
        boundaries: NOTIFICATION_GENERATOR_BOUNDARIES,
        aggregateId: moment.momentId,
        handler: (event) => notifyFromEvent(generator, event, undefined, fanOut),
        clientId: "fan-out-broker",
      });

    await deliver();

    // Read between the deliveries, deliberately. While a notification is unread
    // the partial unique index on the aggregation key collapses repeats on its
    // own — so a fan-out issuing a fresh event identifier per recipient would
    // still leave one row here, and would look correct.
    //
    // Reading it frees that key. From then on the only thing standing between a
    // redelivered message and a second notification is the ledger, keyed on the
    // event and the recipient.
    await database.dataSource.query(
      `UPDATE notifications SET read_at = now() WHERE recipient_user_id = $1`,
      [watcher.userId],
    );

    await deliver();

    assert.equal((await told(watcher.userId)).length, 1, "a redelivery told somebody twice");
  });
});
