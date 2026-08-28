import assert from "node:assert/strict";
import { testContext } from "../../testing/context.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/app-config.js";
import { claimOutboxBatch, markPublished } from "../../lib/database/outbox.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { withTransaction } from "../../lib/database/transaction.js";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import { createEmailClient, type EmailClient } from "../../integrations/email/email-client.js";
import {
  createPushClient,
  PushError,
  type PushClient,
} from "../../integrations/push/push-client.js";
import { buildApp } from "../../server/app.js";
import { TEST_RETENTION_PERIODS } from "../../testing/retention.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { createReadyUpload } from "../../testing/fixtures.js";
import { dispatchDueDeliveries } from "../../workers/notification-dispatcher/dispatch.js";
import { notifyFromEvent } from "../../workers/notification-generator/generate.js";
import { toEnvelope } from "../../workers/outbox-publisher/publish-outbox.js";
import { AuthorizationRepository } from "../authorization/authorization.repository.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { IdentityRepository } from "../authentication/identity.repository.js";
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
import { UploadRepository } from "../uploads/upload.repository.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { NotificationDeliveryRepository } from "./notification.delivery.repository.js";
import { NotificationDeliveryService } from "./notification.delivery.service.js";
import { NotificationGenerator } from "./notification.generator.js";
import { StoredRecipientDirectory } from "./notification.recipients.js";
import { NotificationRepository } from "./notification.repository.js";
import { NotificationService } from "./notification.service.js";

/**
 * Notification delivery, against real infrastructure.
 *
 * The half of notifications that leaves the building, so the questions here are
 * different from 5Q-1's. Those were about who may be told; these are about
 * whether the thing actually goes, whether it goes twice, whether it goes at
 * three in the morning, and whether it carries anything it should not.
 *
 * **Email is asked of Mailpit rather than of a mock.** What matters about a
 * privacy rule is what the recipient reads, and a test that asserts the client
 * was called with a subject proves nothing about the body a template produced.
 * The push adapter is a recording double because there is no provider — but
 * what is asserted about it is the payload, for the same reason.
 *
 * Requires `pnpm infra:up`.
 */

const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? "8025"}`;

const config: AppConfig = {
  nodeEnv: "test",
  logLevel: "fatal",
  host: "127.0.0.1",
  port: 0,
  rateLimit: { maxPerMinute: 100_000 },
  database: {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? "5432"),
    database: process.env.POSTGRES_DATABASE ?? "chronologity",
    user: process.env.POSTGRES_USER ?? "chronologity",
    password: process.env.POSTGRES_PASSWORD ?? "chronologity",
  },
  messaging: { brokers: ["localhost:9092"], clientId: "delivery-integration" },
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

/** A push the recording adapter was asked to send. */
interface RecordedPush {
  readonly deviceId: string;
  readonly platform: string;
  readonly token: string;
  readonly title: string;
  readonly body: string;
}

describe("notification delivery", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;
  let authorization: AuthorizationService;
  let moments: MomentService;
  let reactions: MomentReactionService;
  let comments: MomentCommentService;
  let generator: NotificationGenerator;
  let deliveries: NotificationDeliveryRepository;
  let notificationService: NotificationService;
  let recipients: StoredRecipientDirectory;
  let realEmail: EmailClient;

  /** Moved by the tests, so quiet hours and digests need no waiting. */
  let clock = new Date("2026-06-10T12:00:00Z");
  const now = (): Date => clock;

  /** What the recording push adapter was asked to send. */
  let pushes: RecordedPush[] = [];
  /** Thrown by the next push, if set. */
  let pushRefuses: PushError | undefined;
  /** Thrown by the next email, if set. */
  let emailRefuses: (Error & { responseCode?: number }) | undefined;
  /** Every line the workers wrote, so a token can be searched for. */
  let logLines: string[] = [];

  // Records, and then hands the call to the real adapter so that whatever it
  // writes to a log is written to `logLines` as well. A pure double would leave
  // the adapter's own logging untested, and the thing being asserted about it —
  // that a credential never reaches a log file — is precisely a property of the
  // code a double replaces.
  const push: PushClient = {
    async send(target, message) {
      if (pushRefuses !== undefined) {
        throw pushRefuses;
      }

      pushes.push({
        deviceId: target.deviceId,
        platform: target.platform,
        token: target.token,
        title: message.title,
        body: message.body,
      });

      return createPushClient(logger).send(target, message);
    },
  };

  const email: EmailClient = {
    async send(message) {
      if (emailRefuses !== undefined) {
        throw emailRefuses;
      }

      return realEmail.send(message);
    },
    close: () => realEmail.close(),
  };

  const logger = {
    info: (payload: unknown, message?: string) =>
      logLines.push(`${message} ${JSON.stringify(payload)}`),
    warn: (payload: unknown, message?: string) =>
      logLines.push(`${message} ${JSON.stringify(payload)}`),
    error: (payload: unknown, message?: string) =>
      logLines.push(`${message} ${JSON.stringify(payload)}`),
    debug: () => undefined,
  } as never;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);
    authorization = new AuthorizationService(
      database.dataSource,
      new AuthorizationRepository(database.dataSource),
    );
    // The dispatcher's own connection to the same local mail server. Real
    // delivery, read back from Mailpit afterwards: what a privacy rule is worth
    // is what the recipient actually reads.
    realEmail = createEmailClient(config.email);

    const accounts = new UserRepository(database.dataSource);
    const moderationRepository = new ModerationRepository(database.dataSource);
    const notificationRepository = new NotificationRepository(database.dataSource);

    deliveries = new NotificationDeliveryRepository(database.dataSource);
    recipients = new StoredRecipientDirectory(
      accounts,
      new IdentityRepository(database.dataSource),
    );

    moments = new MomentService(
      database.dataSource,
      new MomentRepository(database.dataSource),
      new UploadRepository(database.dataSource),
      new LocationRepository(database.dataSource),
      new RealWorldEventRepository(database.dataSource),
      new FollowRepository(database.dataSource),
      accounts,
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
      accounts,
    );

    notificationService = new NotificationService(
      database.dataSource,
      notificationRepository,
      moments,
      accounts,
      new FollowRepository(database.dataSource),
      now,
    );

    const delivery = new NotificationDeliveryService(
      database.dataSource,
      deliveries,
      notificationRepository,
      accounts,
      recipients,
      now,
    );

    generator = new NotificationGenerator(
      database.dataSource,
      notificationRepository,
      moments,
      delivery,
      now,
    );

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, accounts, {
        minimumAgeYears: config.minimumAgeYears,
      }),
      authorization,
      moments,
      moderation: new ModerationService(database.dataSource, moderationRepository),
      notifications: notificationService,
      notificationDelivery: delivery,
    });
  });

  afterAll(async () => {
    await app.close();
    await realEmail.close();
    await authentication.close();
    await database.close();
  });

  beforeEach(() => {
    clock = new Date("2026-06-10T12:00:00Z");
    pushes = [];
    pushRefuses = undefined;
    emailRefuses = undefined;
    logLines = [];
  });

  const readLinkFor = async (address: string, timeoutMs = 10_000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await fetch(
        `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
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

    throw new Error(`No sign-in link arrived for ${address}`);
  };

  /** Every message Mailpit currently holds for an address, newest first. */
  const mailFor = async (address: string): Promise<{ subject: string; body: string }[]> => {
    const response = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    const body = (await response.json()) as { messages?: { ID: string }[] };
    const found: { subject: string; body: string }[] = [];

    for (const message of body.messages ?? []) {
      const detail = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`);
      const one = (await detail.json()) as { Subject?: string; Text?: string };

      found.push({ subject: one.Subject ?? "", body: one.Text ?? "" });
    }

    return found;
  };

  /** Wait until an address has more mail than it had, and hand back the newest. */
  const nextMailFor = async (
    address: string,
    before: number,
    timeoutMs = 10_000,
  ): Promise<{ subject: string; body: string }> => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const found = await mailFor(address);

      if (found.length > before) {
        const newest = found[0];

        if (newest !== undefined) {
          return newest;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`No further mail arrived for ${address}`);
  };

  const authed = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  const onboard = async () => {
    const address = uniqueEmail();
    await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email: address } });
    const token = await readLinkFor(address);
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

    return { accessToken, userId: created.json().userId as string, address };
  };

  const OUTBOX_BATCH = 500;

  /**
   * Take one batch from the outbox and hand it back as the consumer would see
   * it. The broker itself is proven elsewhere; what this proves is that the
   * service put the message there in the first place.
   */
  const claimOutboxOnce = async (): Promise<ConsumedEvent[]> => {
    return withTransaction(database.dataSource, async (tx) => {
      const messages = await claimOutboxBatch(tx, OUTBOX_BATCH);

      await markPublished(
        tx,
        messages.map((message) => message.id),
      );

      return messages.map((message) => ({
        topic: message.topic,
        partition: 0,
        offset: "0",
        envelope: toEnvelope(message),
      }));
    });
  };

  /**
   * Drain the outbox completely and let the generator consider every message.
   *
   * Every batch, not one. Nothing publishes the outbox during an integration
   * run, so by the time this suite starts there is a backlog from every suite
   * before it — and a single claim would take five hundred of somebody else's
   * messages and none of this test's. That failed only in the full run, and
   * looked like a scheduling bug rather than a test one.
   */
  const generateFromOutbox = async (): Promise<void> => {
    for (;;) {
      const claimed = await claimOutboxOnce();

      for (const event of claimed) {
        await notifyFromEvent(generator, event);
      }

      if (claimed.length < OUTBOX_BATCH) {
        return;
      }
    }
  };

  /**
   * Run the dispatcher until nothing is due, as the worker itself does.
   *
   * One pass is not enough. The dispatcher claims a bounded batch from the
   * whole table, and by the end of a full integration run there are plenty of
   * other accounts' deliveries in it — so a single pass can finish without
   * having reached the one a test is about. That produced three failures that
   * appeared only in the full suite and never in isolation.
   */
  const dispatch = async () => {
    for (let pass = 0; pass < 50; pass += 1) {
      const result = await dispatchDueDeliveries({
        dataSource: database.dataSource,
        deliveries,
        notifications: notificationService,
        recipients,
        email,
        push,
        now,
        logger,
      });

      if (result.reachedEnd) {
        return result;
      }
    }

    throw new Error("The dispatcher never drained");
  };

  /** Every delivery opened for one account, newest first. */
  const deliveryRowsFor = async (
    userId: string,
  ): Promise<
    { channel: string; mode: string; status: string; attempts: number; dueAt: Date }[]
  > => {
    const rows: {
      channel: string;
      mode: string;
      status: string;
      attempts: number;
      due_at: Date;
    }[] = await database.dataSource.query(
      `SELECT channel, mode, status, attempts, due_at
         FROM notification_deliveries
        WHERE recipient_user_id = $1
        ORDER BY created_at DESC, delivery_id DESC`,
      [userId],
    );

    return rows.map((row) => ({
      channel: row.channel,
      mode: row.mode,
      status: row.status,
      attempts: row.attempts,
      dueAt: row.due_at,
    }));
  };

  /** A Moment somebody recorded, carrying a caption no notification may repeat. */
  const record = async (
    author: { userId: string },
    caption = "A caption nobody outside should read",
  ): Promise<string> => {
    const uploadId = await createReadyUpload(database.dataSource, author.userId);
    const moment = await moments.record(author.userId, {
      caption,
      occurrence: {
        start: "2026-06-01T10:00:00.000Z",
        end: "2026-06-01T10:00:00.000Z",
        precision: "instant",
      },
      occurrenceOffsetMinutes: 0,
      uploadIds: [uploadId],
      visibility: "public",
      locationDisclosure: "exact",
    } as never, testContext());

    return moment.momentId;
  };

  /** A Moment by one person, reacted to by another, with the outbox drained. */
  const reactionTo = async (
    author: { userId: string },
    actor: { userId: string },
  ): Promise<string> => {
    const momentId = await record(author);

    await reactions.react(momentId, actor.userId, "loved");
    await generateFromOutbox();

    return momentId;
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

  /** Set when a channel delivers, through the endpoint that owns it. */
  const setDelivery = async (
    accessToken: string,
    setting: {
      channel: "email" | "push";
      mode: "immediate" | "digest";
      digestHour?: number;
      quietFrom?: number | null;
      quietUntil?: number | null;
    },
  ) => {
    const response = await app.inject({
      method: "PUT",
      url: "/notifications/delivery-settings",
      headers: authed(accessToken),
      payload: {
        settings: [
          {
            channel: setting.channel,
            mode: setting.mode,
            digestHour: setting.digestHour ?? 9,
            quietFrom: setting.quietFrom ?? null,
            quietUntil: setting.quietUntil ?? null,
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200, response.body);

    return response;
  };

  /** Register with a password, prove the address, sign in, and create an account. */
  const onboardWithPassword = async (password = "a reasonable long passphrase") => {
    const address = uniqueEmail();
    const registered = await app.inject({
      method: "POST",
      url: "/auth/registrations",
      payload: { email: address, password },
    });

    assert.equal(registered.statusCode, 202, registered.body);

    const token = await readLinkFor(address);
    const verified = await app.inject({
      method: "POST",
      url: "/auth/email-verifications",
      payload: { token },
    });

    assert.equal(verified.statusCode, 204, verified.body);

    const session = await app.inject({
      method: "POST",
      url: "/auth/sessions/password",
      payload: { email: address, password },
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

    // Registration and verification both happened before the account existed,
    // so they announced changes with nobody to tell. Cleared here so a test can
    // read what its own action produced.
    await generateFromOutbox();

    return { accessToken, userId: created.json().userId as string, address, password };
  };

  it("sends an email, and it says only what it should", async () => {
    const author = await onboard();
    const actor = await onboard();
    const before = (await mailFor(author.address)).length;

    await reactionTo(author, actor);
    await dispatch();

    assert.equal((await deliveryRowsFor(author.userId))[0]?.status, "sent");

    const message = await nextMailFor(author.address, before);

    assert.match(message.body, /reacted to your Moment/);
    // The whole privacy claim of this feature, asked of the thing that actually
    // arrived rather than of the function that produced it.
    assert.doesNotMatch(message.body, /A caption nobody outside should read/);
    assert.doesNotMatch(message.subject, /A caption nobody outside should read/);
  });

  it("opens no delivery on a channel that has been switched off", async () => {
    const author = await onboard();
    const actor = await onboard();

    const changed = await app.inject({
      method: "PUT",
      url: "/notifications/preferences",
      headers: authed(author.accessToken),
      payload: { preferences: [{ category: "social", channel: "email", enabled: false }] },
    });

    assert.equal(changed.statusCode, 200, changed.body);

    await reactionTo(author, actor);

    assert.deepEqual(await deliveryRowsFor(author.userId), []);
  });

  it("opens no push delivery for somebody with no device", async () => {
    const author = await onboard();
    const actor = await onboard();

    await reactionTo(author, actor);

    const rows = await deliveryRowsFor(author.userId);

    assert.deepEqual(
      rows.map((row) => row.channel),
      ["email"],
    );
  });

  it("pushes to a registered device, and never names anybody on it", async () => {
    const author = await onboard();
    const actor = await onboard();

    const registered = await app.inject({
      method: "POST",
      url: "/notifications/devices",
      headers: authed(author.accessToken),
      payload: { platform: "ios", token: `tok-${randomUUID()}`, label: "Phone" },
    });

    assert.equal(registered.statusCode, 201, registered.body);
    // A response that could carry the credential is a response that eventually
    // will, so the shape has no field for one.
    assert.equal("token" in registered.json(), false);

    await reactionTo(author, actor);
    await dispatch();

    assert.equal(pushes.length, 1);
    assert.match(pushes[0]?.body ?? "", /reacted to your Moment/);
    assert.doesNotMatch(pushes[0]?.body ?? "", /Test Person/);
    assert.doesNotMatch(pushes[0]?.body ?? "", /A caption nobody outside should read/);
  });

  it("never writes a device token to a log", async () => {
    const author = await onboard();
    const actor = await onboard();
    const token = `tok-${randomUUID()}`;

    await app.inject({
      method: "POST",
      url: "/notifications/devices",
      headers: authed(author.accessToken),
      payload: { platform: "android", token },
    });

    await reactionTo(author, actor);
    await dispatch();

    assert.equal(pushes[0]?.token, token, "the adapter was given the token");
    assert.equal(
      logLines.some((line) => line.includes(token)),
      false,
      logLines.join("\n"),
    );
  });

  it("reaches every device, and stops at the one that was retired", async () => {
    const author = await onboard();
    const actor = await onboard();

    const first = await app.inject({
      method: "POST",
      url: "/notifications/devices",
      headers: authed(author.accessToken),
      payload: { platform: "ios", token: `tok-${randomUUID()}` },
    });
    await app.inject({
      method: "POST",
      url: "/notifications/devices",
      headers: authed(author.accessToken),
      payload: { platform: "android", token: `tok-${randomUUID()}` },
    });

    await reactionTo(author, actor);
    await dispatch();

    assert.equal(pushes.length, 2, "both devices");

    const retired = await app.inject({
      method: "DELETE",
      url: `/notifications/devices/${first.json().deviceId}`,
      headers: authed(author.accessToken),
    });

    assert.equal(retired.statusCode, 204, retired.body);

    pushes = [];
    const other = await onboard();
    await reactionTo(author, other);
    await dispatch();

    // Signing out on one device must not silence the rest.
    assert.equal(pushes.length, 1);
  });

  it("refreshes a registration rather than opening a second one", async () => {
    const account = await onboard();
    const token = `tok-${randomUUID()}`;

    const first = await app.inject({
      method: "POST",
      url: "/notifications/devices",
      headers: authed(account.accessToken),
      payload: { platform: "ios", token },
    });
    const again = await app.inject({
      method: "POST",
      url: "/notifications/devices",
      headers: authed(account.accessToken),
      payload: { platform: "ios", token },
    });

    assert.equal(again.json().deviceId, first.json().deviceId);

    const rows: { count: string }[] = await database.dataSource.query(
      `SELECT COUNT(*) AS count FROM notification_devices WHERE user_id = $1 AND status = 'active'`,
      [account.userId],
    );

    assert.equal(rows[0]?.count, "1");
  });

  it("moves a token that has changed hands, and the previous account stops receiving", async () => {
    const previous = await onboard();
    const next = await onboard();
    const actor = await onboard();
    const token = `tok-${randomUUID()}`;

    await app.inject({
      method: "POST",
      url: "/notifications/devices",
      headers: authed(previous.accessToken),
      payload: { platform: "ios", token },
    });
    await app.inject({
      method: "POST",
      url: "/notifications/devices",
      headers: authed(next.accessToken),
      payload: { platform: "ios", token },
    });

    await reactionTo(previous, actor);
    await dispatch();

    // Two people's private notifications must not arrive on one lock screen.
    assert.equal(pushes.length, 0);
  });

  it("refuses to retire somebody else's device", async () => {
    const owner = await onboard();
    const stranger = await onboard();

    const registered = await app.inject({
      method: "POST",
      url: "/notifications/devices",
      headers: authed(owner.accessToken),
      payload: { platform: "web", token: `tok-${randomUUID()}` },
    });

    const attempt = await app.inject({
      method: "DELETE",
      url: `/notifications/devices/${registered.json().deviceId}`,
      headers: authed(stranger.accessToken),
    });

    assert.equal(attempt.statusCode, 404, attempt.body);
  });

  it("holds an ordinary notification until quiet hours end", async () => {
    const author = await onboard();
    const actor = await onboard();

    await setDelivery(author.accessToken, {
      channel: "email",
      mode: "immediate",
      quietFrom: 22,
      quietUntil: 7,
    });

    clock = new Date("2026-06-10T23:00:00Z");
    await reactionTo(author, actor);

    const scheduled = await deliveryRowsFor(author.userId);

    assert.equal(scheduled[0]?.status, "pending");
    assert.equal(scheduled[0]?.dueAt.toISOString(), "2026-06-11T07:00:00.000Z");

    await dispatch();

    assert.equal(
      (await deliveryRowsFor(author.userId))[0]?.status,
      "pending",
      "nothing goes out at three in the morning",
    );

    clock = new Date("2026-06-11T07:00:00Z");
    await dispatch();

    assert.equal((await deliveryRowsFor(author.userId))[0]?.status, "sent");
  });

  it("delivers a security notification inside quiet hours immediately", async () => {
    const account = await onboardWithPassword();

    await setDelivery(account.accessToken, {
      channel: "email",
      mode: "immediate",
      quietFrom: 22,
      quietUntil: 7,
    });

    clock = new Date("2026-06-10T23:00:00Z");
    const before = (await mailFor(account.address)).length;

    const changed = await app.inject({
      method: "PUT",
      url: "/auth/password",
      headers: authed(account.accessToken),
      payload: { currentPassword: account.password, newPassword: "another decent passphrase" },
    });

    assert.equal(changed.statusCode, 200, changed.body);

    await generateFromOutbox();

    const rows = await deliveryRowsFor(account.userId);

    // By morning the account may be gone. This is the one thing worth waking
    // somebody for.
    assert.equal(rows[0]?.dueAt.toISOString(), "2026-06-10T23:00:00.000Z");

    await dispatch();

    assert.equal((await deliveryRowsFor(account.userId))[0]?.status, "sent");

    const message = await nextMailFor(account.address, before);

    assert.match(message.subject, /password was changed/i);
  });

  it("holds a moderation notification until quiet hours end", async () => {
    const author = await onboard();
    const moderator = await onboardModerator();

    await setDelivery(author.accessToken, {
      channel: "email",
      mode: "immediate",
      quietFrom: 22,
      quietUntil: 7,
    });

    clock = new Date("2026-06-10T23:00:00Z");
    const momentId = await record(author);

    const decided = await app.inject({
      method: "PUT",
      url: `/moderation/subjects/moment/${momentId}/state`,
      headers: authed(moderator.accessToken),
      payload: { state: "warned", reason: "integration test" },
    });

    assert.equal(decided.statusCode, 200, decided.body);
    await generateFromOutbox();

    const rows = await deliveryRowsFor(author.userId);

    // A moderation decision will still be there at eight, and appealing it is
    // no more possible at three. Waking somebody for it teaches them to silence
    // the device, which silences the security alert above.
    assert.equal(rows[0]?.dueAt.toISOString(), "2026-06-11T07:00:00.000Z");
    assert.equal(rows[0]?.mode, "immediate", "and never held for a digest");
  });

  it("gathers a digest into one message", async () => {
    const author = await onboard();
    const first = await onboard();
    const second = await onboard();

    await setDelivery(author.accessToken, {
      channel: "email",
      mode: "digest",
      digestHour: 9,
    });

    clock = new Date("2026-06-10T12:00:00Z");
    const before = (await mailFor(author.address)).length;

    await reactionTo(author, first);
    await reactionTo(author, second);

    const scheduled = await deliveryRowsFor(author.userId);

    assert.equal(scheduled.length, 2);
    assert.ok(scheduled.every((row) => row.mode === "digest"));
    assert.ok(
      scheduled.every((row) => row.dueAt.toISOString() === "2026-06-11T09:00:00.000Z"),
      JSON.stringify(scheduled),
    );

    clock = new Date("2026-06-11T09:00:00Z");
    await dispatch();

    const completed = await deliveryRowsFor(author.userId);

    assert.deepEqual(
      completed.map((row) => row.status),
      ["sent", "sent"],
    );

    const message = await nextMailFor(author.address, before);

    // Two deliveries, one message. That is what a digest is.
    assert.equal((await mailFor(author.address)).length, before + 1);
    assert.equal(message.body.split("\n").filter((line) => line.length > 0).length, 2);
  });

  it("never holds a required notification for a digest", async () => {
    const account = await onboardWithPassword();

    await setDelivery(account.accessToken, {
      channel: "email",
      mode: "digest",
      digestHour: 9,
    });

    clock = new Date("2026-06-10T12:00:00Z");

    await app.inject({
      method: "PUT",
      url: "/auth/password",
      headers: authed(account.accessToken),
      payload: { currentPassword: account.password, newPassword: "another decent passphrase" },
    });

    await generateFromOutbox();

    const rows = await deliveryRowsFor(account.userId);

    assert.equal(rows[0]?.mode, "immediate");
    assert.equal(rows[0]?.dueAt.toISOString(), "2026-06-10T12:00:00.000Z");
  });

  it("delivers security by email even when the preference says otherwise", async () => {
    const account = await onboardWithPassword();
    const before = (await mailFor(account.address)).length;

    const switched = await app.inject({
      method: "PUT",
      url: "/notifications/preferences",
      headers: authed(account.accessToken),
      payload: {
        preferences: [
          { category: "security", channel: "email", enabled: false },
          { category: "security", channel: "in_app", enabled: false },
        ],
      },
    });

    assert.equal(switched.statusCode, 200, switched.body);

    await app.inject({
      method: "PUT",
      url: "/auth/password",
      headers: authed(account.accessToken),
      payload: { currentPassword: account.password, newPassword: "another decent passphrase" },
    });

    await generateFromOutbox();
    await dispatch();

    // Turning this off is the first thing somebody taking over an account
    // would do, so it cannot be turned off.
    assert.equal((await deliveryRowsFor(account.userId))[0]?.status, "sent");
    assert.match((await nextMailFor(account.address, before)).subject, /password was changed/i);
  });

  it("announces every security change separately", async () => {
    const account = await onboardWithPassword();
    const before = (await mailFor(account.address)).length;

    for (const [current, next] of [
      [account.password, "the second passphrase here"],
      ["the second passphrase here", "the third passphrase here"],
    ]) {
      const changed = await app.inject({
        method: "PUT",
        url: "/auth/password",
        headers: authed(account.accessToken),
        payload: { currentPassword: current, newPassword: next },
      });

      assert.equal(changed.statusCode, 200, changed.body);
      await generateFromOutbox();
    }

    await dispatch();

    // Two changes, two messages. Collapsing the second into the first unread
    // entry would announce it to nobody, and the second is the one somebody
    // most needs to see.
    assert.deepEqual(
      (await deliveryRowsFor(account.userId)).map((row) => row.status),
      ["sent", "sent"],
    );
    await nextMailFor(account.address, before + 1);
  });

  it("retries a transient failure and gives up on a permanent one", async () => {
    const author = await onboard();
    const actor = await onboard();

    await reactionTo(author, actor);

    emailRefuses = new Error("the provider is having a moment");

    await dispatch();

    const afterTransient = await deliveryRowsFor(author.userId);

    assert.equal(afterTransient[0]?.status, "pending", "still to be tried again");
    assert.equal(afterTransient[0]?.attempts, 1);
    assert.ok(afterTransient[0]!.dueAt.getTime() > clock.getTime(), "and not immediately");

    emailRefuses = undefined;
    clock = new Date("2026-06-10T13:00:00Z");
    await dispatch();

    assert.equal(
      (await deliveryRowsFor(author.userId))[0]?.status,
      "sent",
      "the retry got through",
    );
  });

  it("stops at a permanent failure rather than retrying it", async () => {
    const author = await onboard();
    const actor = await onboard();

    await reactionTo(author, actor);

    const refusal: Error & { responseCode?: number } = new Error("550 no such mailbox");
    refusal.responseCode = 550;
    emailRefuses = refusal;

    await dispatch();

    assert.equal((await deliveryRowsFor(author.userId))[0]?.status, "failed");

    emailRefuses = undefined;
    clock = new Date("2026-06-11T13:00:00Z");
    await dispatch();

    // A mailbox that does not exist will not exist tomorrow either.
    const after = await deliveryRowsFor(author.userId);

    assert.equal(after[0]?.status, "failed");
    assert.equal(after[0]?.attempts, 1, "and it was not attempted again");
  });

  it("abandons a delivery that keeps failing", async () => {
    const author = await onboard();
    const actor = await onboard();

    await reactionTo(author, actor);

    emailRefuses = new Error("still unreachable");

    // Two rounds of failure against a ceiling of two. Each round drains, for
    // the same reason `dispatch` does: a single pass need not reach this
    // account's delivery when the table holds other people's.
    for (let round = 0; round < 2; round += 1) {
      clock = new Date(clock.getTime() + 60 * 60 * 1_000);

      for (let pass = 0; pass < 50; pass += 1) {
        const result = await dispatchDueDeliveries({
          dataSource: database.dataSource,
          deliveries,
          notifications: notificationService,
          recipients,
          email,
          push,
          maximumAttempts: 2,
          now,
          logger,
        });

        if (result.reachedEnd) {
          break;
        }
      }
    }

    const rows = await deliveryRowsFor(author.userId);

    // Retried forever is not retrying; it is a queue that never drains.
    assert.equal(rows[0]?.status, "abandoned");
    assert.equal(rows[0]?.attempts, 2);
  });

  it("retires a device the provider refuses, and does not try it again", async () => {
    const author = await onboard();
    const actor = await onboard();

    const registered = await app.inject({
      method: "POST",
      url: "/notifications/devices",
      headers: authed(author.accessToken),
      payload: { platform: "ios", token: `tok-${randomUUID()}` },
    });

    await reactionTo(author, actor);

    pushRefuses = new PushError("invalidToken", "the application was uninstalled");
    await dispatch();

    const device: { status: string }[] = await database.dataSource.query(
      `SELECT status FROM notification_devices WHERE device_id = $1`,
      [registered.json().deviceId],
    );

    assert.equal(device[0]?.status, "invalidated");

    pushRefuses = undefined;
    clock = new Date("2026-06-11T13:00:00Z");
    await dispatch();

    // The token is dead. Attempting it forever is the failure the retry rules
    // exist to prevent.
    assert.equal(pushes.length, 0);
  });

  it("does not send a notification whose subject stopped being visible", async () => {
    const author = await onboard();
    // Somebody mentioned in a comment, rather than the author: an author can
    // always see their own Moment, so they are the one reader who can never
    // lose access to it.
    const named = await onboard();
    const before = (await mailFor(named.address)).length;

    const profile = await app.inject({
      method: "GET",
      url: "/users/me",
      headers: authed(named.accessToken),
    });
    const momentId = await record(author);

    await comments.add(momentId, author.userId, {
      body: `Ask @${profile.json().handle} about this`,
    } as never);
    await generateFromOutbox();

    assert.equal((await deliveryRowsFor(named.userId)).length, 1, "a delivery was opened");

    // The Moment goes private after the mention was scheduled and before it was
    // sent. An email cannot be unsent, which is exactly why the words are built
    // now rather than then.
    await moments.setVisibility(momentId, author.userId, { visibility: "private" }, testContext());

    await dispatch();

    assert.equal((await deliveryRowsFor(named.userId))[0]?.status, "cancelled");
    assert.equal((await mailFor(named.address)).length, before);
  });

  it("delivers nothing twice, however often the dispatcher runs", async () => {
    const author = await onboard();
    const actor = await onboard();
    const before = (await mailFor(author.address)).length;

    await reactionTo(author, actor);

    await dispatch();
    await dispatch();
    await dispatch();

    assert.equal((await deliveryRowsFor(author.userId))[0]?.status, "sent");
    assert.equal((await mailFor(author.address)).length, before + 1);
  });

  it("opens no second delivery when a notification aggregates", async () => {
    const author = await onboard();
    const first = await onboard();
    const second = await onboard();

    const momentId = await record(author);

    await reactions.react(momentId, first.userId, "loved");
    await reactions.react(momentId, second.userId, "amused");
    await generateFromOutbox();

    // One unread entry about one Moment, and so one email about it — not one
    // per person who reacted.
    assert.equal((await deliveryRowsFor(author.userId)).length, 1);
  });

  it("records the activity even when every channel refuses", async () => {
    const author = await onboard();
    const actor = await onboard();

    emailRefuses = new Error("nothing is reachable");

    const momentId = await record(author);

    await reactions.react(momentId, actor.userId, "loved");
    await generateFromOutbox();
    await dispatch();

    const summary = await reactions.summary(momentId, author.userId);
    const listed = await app.inject({
      method: "GET",
      url: "/notifications",
      headers: authed(author.accessToken),
    });

    // Provider delivery must never decide whether the underlying thing
    // happened. The reaction stands and the in-app notification stands; only
    // the email did not go.
    assert.equal(summary.total, 1);
    assert.equal(listed.json().notifications.length, 1);
  });

  it("shows the security category, and shows that it is fixed", async () => {
    const account = await onboard();

    const preferences = await app.inject({
      method: "GET",
      url: "/notifications/preferences",
      headers: authed(account.accessToken),
    });

    assert.equal(preferences.statusCode, 200, preferences.body);

    const body = preferences.json();

    // Returned rather than left out. A category somebody receives messages from
    // and cannot see in their settings is worse than one they cannot change.
    assert.deepEqual(
      [...new Set(body.preferences.map((one: { category: string }) => one.category))].sort(),
      ["media", "moderation", "security", "social"],
    );
    assert.deepEqual([...body.required].sort(), ["moderation", "security"]);
  });

  it("round-trips delivery settings", async () => {
    const account = await onboard();

    const before = await app.inject({
      method: "GET",
      url: "/notifications/delivery-settings",
      headers: authed(account.accessToken),
    });

    assert.equal(before.statusCode, 200, before.body);
    assert.deepEqual(
      before.json().settings.map((one: { channel: string; mode: string }) => one.mode),
      ["immediate", "immediate"],
    );

    await setDelivery(account.accessToken, {
      channel: "push",
      mode: "digest",
      digestHour: 20,
      quietFrom: 23,
      quietUntil: 6,
    });

    const after = await app.inject({
      method: "GET",
      url: "/notifications/delivery-settings",
      headers: authed(account.accessToken),
    });
    const stored = after.json().settings.find((one: { channel: string }) => one.channel === "push");

    assert.deepEqual(stored, {
      channel: "push",
      mode: "digest",
      digestHour: 20,
      quietFrom: 23,
      quietUntil: 6,
    });
  });

  it("refuses a quiet window that cannot mean anything", async () => {
    const account = await onboard();

    for (const window of [
      { quietFrom: 22, quietUntil: 22 },
      { quietFrom: 22, quietUntil: null },
      { quietFrom: 24, quietUntil: 7 },
      { quietFrom: -1, quietUntil: 7 },
    ]) {
      const response = await app.inject({
        method: "PUT",
        url: "/notifications/delivery-settings",
        headers: authed(account.accessToken),
        payload: {
          settings: [{ channel: "email", mode: "immediate", digestHour: 9, ...window }],
        },
      });

      assert.equal(response.statusCode, 400, `${JSON.stringify(window)}: ${response.body}`);
    }
  });

  it("refuses a digest hour that is not an hour", async () => {
    const account = await onboard();

    const response = await app.inject({
      method: "PUT",
      url: "/notifications/delivery-settings",
      headers: authed(account.accessToken),
      payload: {
        settings: [
          {
            channel: "email",
            mode: "digest",
            digestHour: 24,
            quietFrom: null,
            quietUntil: null,
          },
        ],
      },
    });

    assert.equal(response.statusCode, 400, response.body);
  });

  it("refuses every device endpoint to somebody not signed in", async () => {
    // Valid bodies throughout. Fastify validates before it authenticates, so a
    // malformed one would answer 400 and prove nothing about the guard.
    const attempts = [
      {
        method: "POST" as const,
        url: "/notifications/devices",
        payload: { platform: "ios", token: "tok-anything" },
      },
      {
        method: "DELETE" as const,
        url: `/notifications/devices/${randomUUID()}`,
        payload: undefined,
      },
      { method: "GET" as const, url: "/notifications/delivery-settings", payload: undefined },
      {
        method: "PUT" as const,
        url: "/notifications/delivery-settings",
        payload: {
          settings: [
            {
              channel: "email",
              mode: "immediate",
              digestHour: 9,
              quietFrom: null,
              quietUntil: null,
            },
          ],
        },
      },
    ];

    for (const attempt of attempts) {
      const response = await app.inject({
        method: attempt.method,
        url: attempt.url,
        ...(attempt.payload === undefined ? {} : { payload: attempt.payload }),
      });

      assert.equal(response.statusCode, 401, `${attempt.method} ${attempt.url}: ${response.body}`);
    }
  });
});
