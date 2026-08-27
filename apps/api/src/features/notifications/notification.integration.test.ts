import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/app-config.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import { buildApp } from "../../server/app.js";
import { TEST_RETENTION_PERIODS } from "../../testing/retention.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { createReadyUpload } from "../../testing/fixtures.js";
import { AuthorizationRepository } from "../authorization/authorization.repository.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { LocationRepository } from "../locations/location.repository.js";
import { ModerationRepository } from "../moderation/moderation.repository.js";
import { ModerationService } from "../moderation/moderation.service.js";
import { MomentCommentRepository } from "../moments/moment-comment.repository.js";
import { MomentCommentService } from "../moments/moment-comment.service.js";
import { MomentReactionRepository } from "../moments/moment-reaction.repository.js";
import { MomentReactionService } from "../moments/moment-reaction.service.js";
import { MomentRepository } from "../moments/moment.repository.js";
import { MomentService } from "../moments/moment.service.js";
import { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import { FollowRepository } from "../social/follow.repository.js";
import { FollowService } from "../social/follow.service.js";
import { UploadRepository } from "../uploads/upload.repository.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { notifyFromEvent } from "../../workers/notification-generator/generate.js";
import { NotificationGenerator } from "./notification.generator.js";
import { NotificationRepository } from "./notification.repository.js";
import { NotificationService } from "./notification.service.js";

/**
 * Notifications, against real infrastructure.
 *
 * Messages are handed to the generator directly rather than through Kafka. What
 * is under test is which notifications exist and who may see them; the
 * transport is proven once by the media worker's suite, and going through it
 * here would test the broker.
 *
 * The publishing half is tested where it belongs: by reading the outbox, which
 * is where a service's promise to announce something actually lands.
 *
 * Requires `pnpm infra:up`.
 */

const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? "8025"}`;

const config: AppConfig = {
  nodeEnv: "test",
  logLevel: "fatal",
  host: "127.0.0.1",
  port: 0,
  // Raised well above the production ceiling: this suite drives one process
  // through hundreds of requests in a minute, which is not the traffic the
  // limiter defends against.
  rateLimit: { maxPerMinute: 100_000 },
  database: {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? "5432"),
    database: process.env.POSTGRES_DATABASE ?? "chronologity",
    user: process.env.POSTGRES_USER ?? "chronologity",
    password: process.env.POSTGRES_PASSWORD ?? "chronologity",
  },
  messaging: { brokers: ["localhost:9092"], clientId: "notifications-integration" },
  outbox: { retentionMs: 0 },
  retention: { periods: TEST_RETENTION_PERIODS },
  auth: {
    jwtSecret: new TextEncoder().encode("integration-test-secret-long-enough-for-hs256"),
    issuer: "chronologity",
    audience: "chronologity-clients",
    accessTokenTtlSeconds: 600,
    refreshTokenTtlSeconds: 2_592_000,
    magicLinkTtlSeconds: 900,
    phoneCodeTtlSeconds: 300,
    magicLinkBaseUrl: "http://localhost:3000/auth/sessions",
    passwordHashing: { memoryCostKib: 8_192, timeCost: 1, parallelism: 1 },
    passwordPolicy: { minimumLength: 12, maximumLength: 256 },
  },
  minimumAgeYears: 13,
  storage: {
    endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:8333",
    region: process.env.S3_REGION ?? "us-east-1",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "chronologity",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "chronologity-local-secret",
    bucket: process.env.S3_BUCKET ?? "chronologity-media",
    forcePathStyle: true,
    uploadUrlTtlSeconds: 900,
  },
  uploadLimits: {
    registrationTtlSeconds: 3_600,
    maxImageBytes: 26_214_400,
    maxVideoBytes: 524_288_000,
  },
  places: {
    endpoint: "https://nominatim.openstreetmap.org/search",
    userAgent: "Chronologity/0.1 (test)",
    minimumIntervalMs: 0,
    reverseEndpoint: "https://nominatim.openstreetmap.org/reverse",
  },
  email: {
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? "1025"),
    from: process.env.SMTP_FROM ?? "no-reply@chronologity.local",
  },
};

const ADULT = "1990-04-12";
const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

describe("notifications", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;
  let authorization: AuthorizationService;
  let moments: MomentService;
  let reactions: MomentReactionService;
  let comments: MomentCommentService;
  let follows: FollowService;
  let generator: NotificationGenerator;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);
    authorization = new AuthorizationService(
      database.dataSource,
      new AuthorizationRepository(database.dataSource),
    );

    const moderationRepository = new ModerationRepository(database.dataSource);
    const notificationRepository = new NotificationRepository(database.dataSource);

    moments = new MomentService(
      database.dataSource,
      new MomentRepository(database.dataSource),
      new UploadRepository(database.dataSource),
      new LocationRepository(database.dataSource),
      new RealWorldEventRepository(database.dataSource),
      new FollowRepository(database.dataSource),
      new UserRepository(database.dataSource),
      moderationRepository,
      new MomentCommentRepository(database.dataSource),
    );

    reactions = new MomentReactionService(
      database.dataSource,
      new MomentReactionRepository(database.dataSource),
      new MomentRepository(database.dataSource),
      moments,
      new FollowRepository(database.dataSource),
    );

    comments = new MomentCommentService(
      database.dataSource,
      new MomentCommentRepository(database.dataSource),
      new MomentRepository(database.dataSource),
      moments,
      new FollowRepository(database.dataSource),
      new UserRepository(database.dataSource),
    );

    follows = new FollowService(
      database.dataSource,
      new FollowRepository(database.dataSource),
      new UserRepository(database.dataSource),
      new RealWorldEventRepository(database.dataSource),
      new LocationRepository(database.dataSource),
    );

    generator = new NotificationGenerator(database.dataSource, notificationRepository, moments);

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, new UserRepository(database.dataSource), {
        minimumAgeYears: config.minimumAgeYears,
      }),
      authorization,
      follows,
      moments,
      moderation: new ModerationService(database.dataSource, moderationRepository),
      notifications: new NotificationService(
        database.dataSource,
        notificationRepository,
        moments,
        new UserRepository(database.dataSource),
        new FollowRepository(database.dataSource),
      ),
    });
  });

  afterAll(async () => {
    await app.close();
    await authentication.close();
    await database.close();
  });

  const readLinkFor = async (email: string, timeoutMs = 10_000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await fetch(
        `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      );
      const body = (await response.json()) as { messages?: { ID: string }[] };
      const id = body.messages?.[0]?.ID;

      if (id !== undefined) {
        const message = await fetch(`${MAILPIT}/api/v1/message/${id}`);
        const detail = (await message.json()) as { Text?: string };
        const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(detail.Text ?? "")?.[1];

        if (token !== undefined) {
          return token;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error(`No sign-in link arrived for ${email}`);
  };

  const authed = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  const onboard = async () => {
    const email = uniqueEmail();
    await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
    const token = await readLinkFor(email);
    const session = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token },
    });

    assert.equal(session.statusCode, 201, session.body);

    const accessToken = session.json().accessToken as string;
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(accessToken),
      payload: { handle: uniqueHandle(), displayName: "Test Person", dateOfBirth: ADULT },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { accessToken, userId: created.json().userId as string };
  };

  const onboardModerator = async () => {
    const account = await onboard();

    await authorization.assign(account.userId, "moderator", undefined, "integration test", {
      traceId: randomUUID(),
      actor: undefined,
      receivedAt: new Date(),
    });

    return account;
  };

  const summer = {
    start: "1998-06-01T00:00:00.000Z",
    end: "1998-08-31T23:59:59.000Z",
    precision: "month",
  } as const;

  const record = async (author: { userId: string }, caption = "A thing that happened") => {
    const uploadId = await createReadyUpload(database.dataSource, author.userId);
    const moment = await moments.record(author.userId, {
      caption,
      occurrence: summer,
      occurrenceOffsetMinutes: 0,
      uploadIds: [uploadId],
      visibility: "public",
      locationDisclosure: "exact",
    } as never);

    return moment.momentId;
  };

  /**
   * Hand the generator everything the outbox holds about one thing.
   *
   * Keyed on the partition rather than the aggregate. A comment event is
   * about a comment but is partitioned on the Moment being discussed, so that
   * a comment and the reply to it stay ordered — which means the partition is
   * what gathers everything concerning one Moment.
   */
  const deliver = async (partitionKey: string) => {
    const rows: { id: string; event_type: string; payload: unknown; created_at: Date }[] =
      await database.dataSource.query(
        `SELECT id, event_type, payload, created_at FROM outbox_messages
          WHERE partition_key = $1 ORDER BY created_at, id`,
        [partitionKey],
      );

    for (const row of rows) {
      const event: ConsumedEvent = {
        topic: "test",
        partition: 0,
        offset: "0",
        envelope: {
          eventId: row.id,
          eventType: row.event_type,
          eventVersion: 1,
          occurredAt: row.created_at.toISOString(),
          aggregate: { type: "test", id: partitionKey, version: 0 },
          payload: row.payload,
        },
      };

      await notifyFromEvent(generator, event);
    }

    return rows;
  };

  const list = async (accessToken: string, params: Record<string, string | number> = {}) =>
    app.inject({
      method: "GET",
      url: `/notifications?${new URLSearchParams(
        Object.entries(params).map(([key, value]): [string, string] => [key, String(value)]),
      ).toString()}`,
      headers: authed(accessToken),
    });

  const typesFor = (response: { json(): { notifications: { type: string }[] } }) =>
    response.json().notifications.map((one) => one.type);

  const unreadCount = async (accessToken: string) =>
    (
      await app.inject({
        method: "GET",
        url: "/notifications/unread-count",
        headers: authed(accessToken),
      })
    ).json().unread as number;

  describe("what produces a notification", () => {
    it("tells an author somebody reacted", async () => {
      const author = await onboard();
      const reactor = await onboard();
      const momentId = await record(author);

      await reactions.react(momentId, reactor.userId, "loved");
      await deliver(momentId);

      assert.deepEqual(typesFor(await list(author.accessToken)), ["moment_reacted"]);
    });

    it("tells an author somebody commented", async () => {
      const author = await onboard();
      const talker = await onboard();
      const momentId = await record(author);

      await comments.add(momentId, talker.userId, { body: "Something said" } as never);
      await deliver(momentId);

      assert.ok(typesFor(await list(author.accessToken)).includes("moment_commented"));
    });

    it("tells somebody they were answered", async () => {
      const author = await onboard();
      const first = await onboard();
      const second = await onboard();
      const momentId = await record(author);

      const parent = await comments.add(momentId, first.userId, {
        body: "Something said",
      } as never);
      await comments.add(momentId, second.userId, {
        body: "An answer",
        inReplyToCommentId: parent.commentId,
      } as never);
      await deliver(momentId);

      assert.ok(typesFor(await list(first.accessToken)).includes("comment_replied"));
    });

    it("tells somebody they were named", async () => {
      const author = await onboard();
      const talker = await onboard();
      const named = await onboard();
      const namedHandle = (
        await app.inject({
          method: "GET",
          url: "/users/me",
          headers: authed(named.accessToken),
        })
      ).json().handle;
      const momentId = await record(author);

      await comments.add(momentId, talker.userId, {
        body: `Ask @${namedHandle} about this`,
      } as never);
      await deliver(momentId);

      assert.ok(typesFor(await list(named.accessToken)).includes("comment_mentioned"));
    });

    it("tells somebody they were followed", async () => {
      const followed = await onboard();
      const follower = await onboard();

      await follows.follow(follower.userId, followed.userId);
      await deliver(followed.userId);

      assert.deepEqual(typesFor(await list(followed.accessToken)), ["user_followed"]);
    });

    it("tells somebody what was done to their content", async () => {
      const author = await onboard();
      const moderator = await onboardModerator();
      const momentId = await record(author);

      await app.inject({
        method: "PUT",
        url: `/moderation/subjects/moment/${momentId}/state`,
        headers: authed(moderator.accessToken),
        payload: { state: "warned", reason: "integration test" },
      });
      await deliver(momentId);

      assert.ok(typesFor(await list(author.accessToken)).includes("content_moderated"));
    });

    it("never names the moderator who decided", async () => {
      const author = await onboard();
      const moderator = await onboardModerator();
      const momentId = await record(author);

      await app.inject({
        method: "PUT",
        url: `/moderation/subjects/moment/${momentId}/state`,
        headers: authed(moderator.accessToken),
        payload: { state: "warned", reason: "integration test" },
      });
      await deliver(momentId);

      const response = await list(author.accessToken);
      const moderated = response
        .json()
        .notifications.find((one: { type: string }) => one.type === "content_moderated");

      // 5N keeps reviewer identity out of what the affected person sees, and a
      // notification would be the easiest place to leak it.
      assert.deepEqual(moderated.actors, []);
      assert.equal(response.body.includes(moderator.userId), false);
    });

    it("tells nobody about their own activity", async () => {
      const author = await onboard();
      const momentId = await record(author);

      await reactions.react(momentId, author.userId, "loved");
      await comments.add(momentId, author.userId, { body: "My own comment" } as never);
      await deliver(momentId);

      assert.deepEqual(typesFor(await list(author.accessToken)), []);
    });
  });

  describe("surviving redelivery and collapsing noise", () => {
    it("produces one notification however often a message arrives", async () => {
      const author = await onboard();
      const reactor = await onboard();
      const momentId = await record(author);

      await reactions.react(momentId, reactor.userId, "loved");

      await deliver(momentId);
      await deliver(momentId);
      await deliver(momentId);

      assert.equal((await list(author.accessToken)).json().notifications.length, 1);
    });

    it("collapses several people into one unread entry", async () => {
      const author = await onboard();
      const momentId = await record(author);

      for (let i = 0; i < 3; i += 1) {
        const reactor = await onboard();

        await reactions.react(momentId, reactor.userId, "loved");
      }

      await deliver(momentId);

      const notifications = (await list(author.accessToken)).json().notifications;

      assert.equal(notifications.length, 1);
      // Two named, the rest counted: a notification is a sentence.
      assert.equal(notifications[0].actors.length, 2);
      assert.equal(notifications[0].otherActors, 1);
    });

    it("opens a fresh entry once the first has been read", async () => {
      const author = await onboard();
      const momentId = await record(author);
      const first = await onboard();

      await reactions.react(momentId, first.userId, "loved");
      await deliver(momentId);

      await app.inject({
        method: "PUT",
        url: "/notifications/read",
        headers: authed(author.accessToken),
      });

      const second = await onboard();

      await reactions.react(momentId, second.userId, "amused");
      await deliver(momentId);

      const notifications = (await list(author.accessToken)).json().notifications;

      assert.equal(notifications.length, 2);
      assert.equal(notifications[0].readAt, null);
      assert.notEqual(notifications[1].readAt, null);
    });

    it("keeps two people's notifications about one thing apart", async () => {
      const author = await onboard();
      const talker = await onboard();
      const named = await onboard();
      const namedHandle = (
        await app.inject({
          method: "GET",
          url: "/users/me",
          headers: authed(named.accessToken),
        })
      ).json().handle;
      const momentId = await record(author);

      await comments.add(momentId, talker.userId, {
        body: `Ask @${namedHandle} about this`,
      } as never);
      await deliver(momentId);

      // One comment, two recipients, two independent notifications.
      assert.ok(typesFor(await list(author.accessToken)).includes("moment_commented"));
      assert.ok(typesFor(await list(named.accessToken)).includes("comment_mentioned"));
    });
  });

  describe("what a notification must never reveal", () => {
    it("stores no caption, comment, or name anywhere", async () => {
      const author = await onboard();
      const talker = await onboard();
      const caption = `zq${randomUUID().replaceAll("-", "").slice(0, 10)}`;
      const said = `zq${randomUUID().replaceAll("-", "").slice(0, 10)}`;
      const momentId = await record(author, caption);

      await comments.add(momentId, talker.userId, { body: said } as never);
      await deliver(momentId);

      // Asserted against the whole table rather than against a column list: a
      // column added later would have to make this fail rather than quietly
      // pass.
      const rows: { row: string }[] = await database.dataSource.query(
        `SELECT n::text AS row FROM notifications n WHERE recipient_user_id = $1`,
        [author.userId],
      );

      assert.ok(rows.length > 0);

      for (const row of rows) {
        assert.equal(row.row.includes(caption), false, "a caption reached the table");
        assert.equal(row.row.includes(said), false, "a comment reached the table");
      }
    });

    it("says nothing about a Moment the reader may no longer see", async () => {
      const author = await onboard();
      const reactor = await onboard();
      const momentId = await record(author);

      await reactions.react(momentId, reactor.userId, "loved");
      await deliver(momentId);
      assert.equal(await unreadCount(author.accessToken), 1);

      // The author can always see their own, so the reader here is somebody
      // mentioned in a comment on a Moment that then becomes private.
      const named = await onboard();
      const namedHandle = (
        await app.inject({
          method: "GET",
          url: "/users/me",
          headers: authed(named.accessToken),
        })
      ).json().handle;

      await comments.add(momentId, author.userId, {
        body: `Ask @${namedHandle} about this`,
      } as never);
      await deliver(momentId);
      assert.ok(typesFor(await list(named.accessToken)).includes("comment_mentioned"));

      await moments.setVisibility(momentId, author.userId, { visibility: "private" });

      // Absent rather than blanked, and gone from the count as well as the
      // list. A count that outran the list would say something existed.
      assert.deepEqual(typesFor(await list(named.accessToken)), []);
      assert.equal(await unreadCount(named.accessToken), 0);
    });

    it("refuses to open a notification whose destination is no longer visible", async () => {
      const author = await onboard();
      const named = await onboard();
      const namedHandle = (
        await app.inject({
          method: "GET",
          url: "/users/me",
          headers: authed(named.accessToken),
        })
      ).json().handle;
      const momentId = await record(author);

      await comments.add(momentId, author.userId, {
        body: `Ask @${namedHandle} about this`,
      } as never);
      await deliver(momentId);

      const notificationId = (await list(named.accessToken)).json().notifications[0].notificationId;

      await moments.setVisibility(momentId, author.userId, { visibility: "private" });

      const opened = await app.inject({
        method: "GET",
        url: `/notifications/${notificationId}`,
        headers: authed(named.accessToken),
      });

      // A deep link is a pointer and never a permission.
      assert.equal(opened.statusCode, 404, opened.body);
    });

    it("counts a blocked person rather than naming them", async () => {
      const author = await onboard();
      const reactor = await onboard();
      const momentId = await record(author);

      await reactions.react(momentId, reactor.userId, "loved");
      await deliver(momentId);
      assert.equal((await list(author.accessToken)).json().notifications[0].actors.length, 1);

      await app.inject({
        method: "POST",
        url: `/users/${reactor.userId}/block`,
        headers: authed(author.accessToken),
      });

      const after = (await list(author.accessToken)).json().notifications[0];

      assert.deepEqual(after.actors, []);
      assert.equal(after.otherActors, 1);
    });

    it("removes a follow notification once a Block separates the two", async () => {
      const followed = await onboard();
      const follower = await onboard();

      await follows.follow(follower.userId, followed.userId);
      await deliver(followed.userId);
      assert.deepEqual(typesFor(await list(followed.accessToken)), ["user_followed"]);

      await app.inject({
        method: "POST",
        url: `/users/${follower.userId}/block`,
        headers: authed(followed.accessToken),
      });

      // A notification whose whole content is a person has nothing left to say.
      assert.deepEqual(typesFor(await list(followed.accessToken)), []);
    });

    it("counts a suspended person rather than naming them", async () => {
      const author = await onboard();
      const reactor = await onboard();
      const moderator = await onboardModerator();
      const momentId = await record(author);

      await reactions.react(momentId, reactor.userId, "loved");
      await deliver(momentId);

      await app.inject({
        method: "PUT",
        url: `/users/${reactor.userId}/suspension`,
        headers: authed(moderator.accessToken),
        payload: { suspended: true, reason: "integration test" },
      });

      const after = (await list(author.accessToken)).json().notifications[0];

      assert.deepEqual(after.actors, []);
      assert.equal(after.otherActors, 1);
    });

    it("never tells somebody about activity on a Moment they cannot see", async () => {
      const author = await onboard();
      const talker = await onboard();
      const named = await onboard();
      const namedHandle = (
        await app.inject({
          method: "GET",
          url: "/users/me",
          headers: authed(named.accessToken),
        })
      ).json().handle;
      const momentId = await record(author);

      await moments.setVisibility(momentId, author.userId, { visibility: "private" });

      // The comment cannot be added to a private Moment by a stranger, so the
      // author names them on their own private Moment — the eligibility check
      // is what has to refuse, not the comment.
      await comments.add(momentId, author.userId, {
        body: `Ask @${namedHandle} about this`,
      } as never);
      await deliver(momentId);

      assert.deepEqual(typesFor(await list(named.accessToken)), []);
      assert.equal(talker.userId.length > 0, true);
    });
  });

  describe("the generator's own refusal", () => {
    /**
     * Asked of the generator directly, not through a request.
     *
     * There are two defences against telling somebody about a Moment they may
     * not see: the generator declines to write the notification, and the reader
     * declines to render it. Deliberately removing the first broke nothing —
     * the second covered for it — which made the first a guard no test could
     * fail. Two defences are worth having; one of them being unprovable is not.
     */
    it("writes nothing at all about a Moment the recipient may not see", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const momentId = await record(author);

      await moments.setVisibility(momentId, author.userId, { visibility: "private" });

      const outcome = await generator.consider(
        {
          type: "comment_mentioned",
          actorUserId: author.userId,
          subjectUserId: stranger.userId,
          sourceType: "comment",
          sourceId: randomUUID(),
          viaMomentId: momentId,
        },
        randomUUID(),
      );

      assert.equal(outcome, "not_eligible");

      // Not merely hidden at read time: no row exists.
      const rows: { count: number }[] = await database.dataSource.query(
        "SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_user_id = $1",
        [stranger.userId],
      );

      assert.equal(rows[0]?.count, 0);
    });

    it("writes one about a Moment the recipient may see", async () => {
      const author = await onboard();
      const reader = await onboard();
      const momentId = await record(author);

      const outcome = await generator.consider(
        {
          type: "comment_mentioned",
          actorUserId: author.userId,
          subjectUserId: reader.userId,
          sourceType: "comment",
          sourceId: randomUUID(),
          viaMomentId: momentId,
        },
        randomUUID(),
      );

      // The other half of the pair: without this, the test above would pass
      // just as well against a generator that never wrote anything.
      assert.equal(outcome, "notified");
    });

    it("reports a redelivery as a duplicate rather than writing twice", async () => {
      const author = await onboard();
      const reader = await onboard();
      const momentId = await record(author);
      const eventId = randomUUID();
      const candidate = {
        type: "comment_mentioned" as const,
        actorUserId: author.userId,
        subjectUserId: reader.userId,
        sourceType: "comment" as const,
        sourceId: randomUUID(),
        viaMomentId: momentId,
      };

      assert.equal(await generator.consider(candidate, eventId), "notified");
      assert.equal(await generator.consider(candidate, eventId), "duplicate");
    });

    it("reports a suppressed category as suppressed rather than silently doing nothing", async () => {
      const author = await onboard();
      const reader = await onboard();
      const momentId = await record(author);

      await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        headers: authed(reader.accessToken),
        payload: { preferences: [{ category: "social", channel: "in_app", enabled: false }] },
      });

      const outcome = await generator.consider(
        {
          type: "comment_mentioned",
          actorUserId: author.userId,
          subjectUserId: reader.userId,
          sourceType: "comment",
          sourceId: randomUUID(),
          viaMomentId: momentId,
        },
        randomUUID(),
      );

      // Distinguishable from `not_eligible`, which matters: one means they were
      // not owed it and the other means they asked not to hear it.
      assert.equal(outcome, "suppressed");
    });
  });

  describe("read state and preferences", () => {
    it("agrees between the list, the count, and marking read", async () => {
      const author = await onboard();
      const reactor = await onboard();
      const momentId = await record(author);

      await reactions.react(momentId, reactor.userId, "loved");
      await deliver(momentId);

      assert.equal(await unreadCount(author.accessToken), 1);

      const notificationId = (await list(author.accessToken)).json().notifications[0]
        .notificationId;

      const marked = await app.inject({
        method: "PUT",
        url: `/notifications/${notificationId}/read`,
        headers: authed(author.accessToken),
      });

      assert.equal(marked.statusCode, 204, marked.body);
      assert.equal(await unreadCount(author.accessToken), 0);
      assert.equal(
        (await list(author.accessToken, { unreadOnly: "true" })).json().notifications.length,
        0,
      );
      assert.equal((await list(author.accessToken)).json().notifications.length, 1);
    });

    it("takes a dismissed notification out of the list entirely", async () => {
      const author = await onboard();
      const reactor = await onboard();
      const momentId = await record(author);

      await reactions.react(momentId, reactor.userId, "loved");
      await deliver(momentId);

      const notificationId = (await list(author.accessToken)).json().notifications[0]
        .notificationId;

      await app.inject({
        method: "PUT",
        url: `/notifications/${notificationId}/dismissed`,
        headers: authed(author.accessToken),
      });

      // Dismissing marks it read as well: leaving it counted would be a badge
      // nobody can clear.
      assert.deepEqual(typesFor(await list(author.accessToken)), []);
      assert.equal(await unreadCount(author.accessToken), 0);
    });

    it("refuses to read somebody else's notification", async () => {
      const author = await onboard();
      const reactor = await onboard();
      const nosy = await onboard();
      const momentId = await record(author);

      await reactions.react(momentId, reactor.userId, "loved");
      await deliver(momentId);

      const notificationId = (await list(author.accessToken)).json().notifications[0]
        .notificationId;

      const opened = await app.inject({
        method: "GET",
        url: `/notifications/${notificationId}`,
        headers: authed(nosy.accessToken),
      });

      // Absent rather than forbidden: that a notification exists is itself a
      // disclosure about activity they are not party to.
      assert.equal(opened.statusCode, 404, opened.body);
    });

    it("suppresses a category somebody switched off", async () => {
      const author = await onboard();
      const reactor = await onboard();
      const momentId = await record(author);

      await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        headers: authed(author.accessToken),
        payload: {
          preferences: [{ category: "social", channel: "in_app", enabled: false }],
        },
      });

      await reactions.react(momentId, reactor.userId, "loved");
      await deliver(momentId);

      assert.deepEqual(typesFor(await list(author.accessToken)), []);
    });

    it("delivers moderation whatever the preference says", async () => {
      const author = await onboard();
      const moderator = await onboardModerator();
      const momentId = await record(author);

      const preferences = await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        headers: authed(author.accessToken),
        payload: {
          preferences: [{ category: "moderation", channel: "in_app", enabled: false }],
        },
      });

      assert.equal(preferences.statusCode, 200, preferences.body);
      assert.ok(preferences.json().required.includes("moderation"));

      await app.inject({
        method: "PUT",
        url: `/moderation/subjects/moment/${momentId}/state`,
        headers: authed(moderator.accessToken),
        payload: { state: "warned", reason: "integration test" },
      });
      await deliver(momentId);

      // An appeal against a decision somebody was never told about is not a
      // right they have.
      assert.ok(typesFor(await list(author.accessToken)).includes("content_moderated"));
    });

    it("cannot turn a preference into a notification somebody was not owed", async () => {
      const author = await onboard();
      const named = await onboard();
      const namedHandle = (
        await app.inject({
          method: "GET",
          url: "/users/me",
          headers: authed(named.accessToken),
        })
      ).json().handle;
      const momentId = await record(author);

      await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        headers: authed(named.accessToken),
        payload: {
          preferences: [{ category: "social", channel: "in_app", enabled: true }],
        },
      });

      await moments.setVisibility(momentId, author.userId, { visibility: "private" });
      await comments.add(momentId, author.userId, {
        body: `Ask @${namedHandle} about this`,
      } as never);
      await deliver(momentId);

      // Preferences cannot grant access somebody otherwise lacks.
      assert.deepEqual(typesFor(await list(named.accessToken)), []);
    });

    it("reports every category on every channel", async () => {
      const account = await onboard();

      const response = await app.inject({
        method: "GET",
        url: "/notifications/preferences",
        headers: authed(account.accessToken),
      });

      // Four categories on three channels. Security joined the list when
      // delivery arrived, and it is shown rather than hidden: a category
      // somebody receives messages from and cannot see in their settings is
      // worse than one they cannot change.
      assert.equal(response.json().preferences.length, 12);
      assert.deepEqual([...response.json().required].sort(), ["moderation", "security"]);

      for (const preference of response.json().preferences) {
        // Absence means yes: somebody who has never opened the settings has not
        // asked for silence.
        assert.equal(preference.enabled, true);
      }
    });
  });
});
