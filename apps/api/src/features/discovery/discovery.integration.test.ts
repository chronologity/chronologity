import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/app-config.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { createReadyUpload } from "../../testing/fixtures.js";
import { AuthorizationRepository } from "../authorization/authorization.repository.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { LocationRepository } from "../locations/location.repository.js";
import { ModerationRepository } from "../moderation/moderation.repository.js";
import { ModerationService } from "../moderation/moderation.service.js";
import { MomentCommentRepository } from "../moments/moment-comment.repository.js";
import { MomentRepository } from "../moments/moment.repository.js";
import { MomentService } from "../moments/moment.service.js";
import { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import { SearchIndexer } from "../search/search.indexer.js";
import { SearchRepository } from "../search/search.repository.js";
import { SearchSourceRepository } from "../search/search-source.repository.js";
import { PostgresSearchRetrieval } from "../search/search.retrieval.js";
import { SearchService } from "../search/search.service.js";
import { FollowRepository } from "../social/follow.repository.js";
import { FollowService } from "../social/follow.service.js";
import { UploadRepository } from "../uploads/upload.repository.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { DiscoveryRetrieval } from "./discovery.retrieval.js";
import { DiscoveryService } from "./discovery.service.js";

/**
 * Discovery, against real infrastructure.
 *
 * Almost every test here is a negative. That is the shape of the feature: the
 * claim is not that Discovery finds things, it is that Discovery finds strictly
 * less than Search does, and the only way to believe that is to try each way it
 * could fail.
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
  messaging: { brokers: ["localhost:9092"], clientId: "discovery-integration" },
  outbox: { retentionMs: 0 },
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

/** Fifteen today: old enough for an account, not old enough to be recommended. */
const teenBirthday = () => {
  const born = new Date();

  born.setUTCFullYear(born.getUTCFullYear() - 15);

  return born.toISOString().slice(0, 10);
};

const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;
/**
 * A word no real caption contains.
 *
 * Letters rather than hexadecimal, and the reason is measurable. Hex has
 * sixteen symbols, so two of these share enough trigrams to reach similarity
 * 0.3 — which is exactly the threshold search retrieves at, so one test's word
 * matched another test's Moment and an exact-result assertion failed. Three
 * pairs in two hundred words. Over twenty-six letters, four hundred words peak
 * at 0.200 and nothing collides.
 */
const rareWord = () =>
  `zq${Array.from({ length: 12 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("")}`;

describe("discovery", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;
  let authorization: AuthorizationService;
  let moments: MomentService;
  let indexer: SearchIndexer;

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

    indexer = new SearchIndexer(
      database.dataSource,
      new SearchRepository(database.dataSource),
      new SearchSourceRepository(database.dataSource),
    );

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

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, new UserRepository(database.dataSource), {
        minimumAgeYears: config.minimumAgeYears,
      }),
      authorization,
      follows: new FollowService(
        database.dataSource,
        new FollowRepository(database.dataSource),
        new UserRepository(database.dataSource),
        new RealWorldEventRepository(database.dataSource),
        new LocationRepository(database.dataSource),
      ),
      moments,
      moderation: new ModerationService(database.dataSource, moderationRepository),
      search: new SearchService(
        new PostgresSearchRetrieval(database.dataSource),
        moderationRepository,
      ),
      searchRateLimits: {
        searchesPerWindow: 100_000,
        suggestionsPerWindow: 100_000,
        windowMinutes: 1,
      },
      discovery: new DiscoveryService(
        new DiscoveryRetrieval(database.dataSource),
        moderationRepository,
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

  const onboard = async (dateOfBirth = ADULT) => {
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
      payload: { handle: uniqueHandle(), displayName: "Test Person", dateOfBirth },
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

  /** Long enough ago to count as historical rather than recent. */
  const longAgo = {
    start: "1998-06-01T00:00:00.000Z",
    end: "1998-08-31T23:59:59.000Z",
    precision: "month",
  } as const;

  const recordAndIndex = async (
    author: { accessToken: string; userId: string },
    caption: string,
    over: Record<string, unknown> = {},
  ) => {
    const uploadId = await createReadyUpload(database.dataSource, author.userId);
    const moment = await moments.record(author.userId, {
      caption,
      occurrence: longAgo,
      occurrenceOffsetMinutes: 0,
      uploadIds: [uploadId],
      visibility: "public",
      locationDisclosure: "exact",
      ...over,
    } as never);

    await indexer.index("moment", moment.momentId);

    return moment.momentId;
  };

  /** Give a Moment enough significance to surface, and reindex. */
  const makeSignificant = async (momentId: string, value = 40) => {
    await database.dataSource.query(
      `INSERT INTO moment_significance
         (moment_id, scope_type, scope_id, dimension, value, baseline_value,
          provenance, algorithm_version, computed_at)
       VALUES ($1, 'global', $1, 'causal', $2, $2, 'graph', 'significance-v1', now())
       ON CONFLICT DO NOTHING`,
      [momentId, value],
    );
    await indexer.index("moment", momentId);
  };

  const explore = async (accessToken: string, params: Record<string, string | number> = {}) =>
    app.inject({
      method: "GET",
      url: `/discovery/explore?${new URLSearchParams(
        Object.entries(params).map(([key, value]): [string, string] => [key, String(value)]),
      ).toString()}`,
      headers: authed(accessToken),
    });

  const recommendedIds = (response: { json(): { recommendations: { momentId: string }[] } }) =>
    response.json().recommendations.map((one) => one.momentId);

  const searchIds = async (accessToken: string, q: string) =>
    (
      await app.inject({
        method: "GET",
        url: `/search?q=${encodeURIComponent(q)}`,
        headers: authed(accessToken),
      })
    )
      .json()
      .results.map((result: { entityId: string }) => result.entityId);

  /** A fresh Event nothing else belongs to, so a surface has a controlled set. */
  const freshEvent = async (creator: { userId: string }) => {
    const realWorldEventId = randomUUID();

    await database.dataSource.query(
      `INSERT INTO real_world_events (real_world_event_id, created_by_user_id, name,
                                      occurrence_start, occurrence_end, occurrence_precision,
                                      created_at, updated_at)
       VALUES ($1, $2, $3, '1998-01-01', '1998-12-31', 'year', now(), now())`,
      [realWorldEventId, creator.userId, rareWord()],
    );

    return realWorldEventId;
  };

  const attach = async (momentId: string, realWorldEventId: string) => {
    await database.dataSource.query(
      `INSERT INTO moment_real_world_events (moment_id, real_world_event_id, origin, created_at)
       VALUES ($1, $2, 'user-asserted', now()) ON CONFLICT DO NOTHING`,
      [momentId, realWorldEventId],
    );
    await indexer.index("moment", momentId);
  };

  /** Claim one Moment led to another. */
  const assertRelationship = async (
    assertedByUserId: string,
    sourceMomentId: string,
    targetMomentId: string,
  ) => {
    await database.dataSource.query(
      `INSERT INTO moment_relationships (relationship_id, source_moment_id, target_moment_id,
                                         kind, origin, asserted_by_user_id, created_at)
       VALUES ($1, $2, $3, 'led_to', 'asserted', $4, now())`,
      [randomUUID(), sourceMomentId, targetMomentId, assertedByUserId],
    );
  };

  const fromEvent = async (accessToken: string, realWorldEventId: string) =>
    app.inject({
      method: "GET",
      url: `/discovery/events/${realWorldEventId}?limit=50`,
      headers: authed(accessToken),
    });

  /**
   * A Moment in an Event nobody else is in, and whether a Viewer is offered it.
   *
   * Scoped rather than paging Explore: the shared database holds thousands of
   * Moments, and a test that has to page through all of them to prove an
   * absence is a test that proves nothing when it times out.
   */
  const offeredTo = async (
    viewer: { accessToken: string },
    realWorldEventId: string,
    momentId: string,
  ) => recommendedIds(await fromEvent(viewer.accessToken, realWorldEventId)).includes(momentId);

  describe("what may be offered", () => {
    it("offers a public, discoverable Moment", async () => {
      const author = await onboard();
      const event = await freshEvent(author);
      const momentId = await recordAndIndex(author, rareWord());
      await attach(momentId, event);
      const stranger = await onboard();

      assert.equal(await offeredTo(stranger, event, momentId), true);
    });

    it("says why it was offered", async () => {
      const author = await onboard();
      const event = await freshEvent(author);
      const momentId = await recordAndIndex(author, rareWord());
      await attach(momentId, event);

      const offered = (await fromEvent(author.accessToken, event)).json().recommendations[0];

      assert.deepEqual(offered.because, ["same_event"]);
    });

    it("returns no score of any kind", async () => {
      const author = await onboard();
      const event = await freshEvent(author);
      const momentId = await recordAndIndex(author, rareWord());
      await attach(momentId, event);

      const offered = (await fromEvent(author.accessToken, event)).json().recommendations[0];

      // A number beside a recommendation reads as a claim about historical
      // importance whatever it is labelled.
      assert.equal(offered.score, undefined);
      assert.equal(offered.significance, undefined);
    });

    it("returns an empty page for an Event with no eligible history", async () => {
      const author = await onboard();
      const event = await freshEvent(author);
      const stranger = await onboard();

      const response = await fromEvent(stranger.accessToken, event);

      // That the Event exists is not a secret; how much of its history reaches
      // this Viewer is.
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().recommendations, []);
    });
  });

  describe("what must never be offered", () => {
    it("never offers an unlisted Moment, though it stays reachable", async () => {
      const author = await onboard();
      const event = await freshEvent(author);
      const word = rareWord();
      const momentId = await recordAndIndex(author, word);
      await attach(momentId, event);
      const stranger = await onboard();

      assert.equal(await offeredTo(stranger, event, momentId), true);

      const unlisted = await app.inject({
        method: "PUT",
        url: `/moments/${momentId}/discoverability`,
        headers: authed(author.accessToken),
        payload: { discoverable: false },
      });

      assert.equal(unlisted.statusCode, 200, unlisted.body);
      await indexer.index("moment", momentId);

      // Out of every surface, and still reachable by anybody with the link and
      // still findable by somebody who searches for it.
      assert.equal(await offeredTo(stranger, event, momentId), false);
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: `/moments/${momentId}`,
            headers: authed(stranger.accessToken),
          })
        ).statusCode,
        200,
      );
      assert.ok((await searchIds(stranger.accessToken, word)).includes(momentId));
    });

    it("never offers a restricted Moment, not even to its audience", async () => {
      const author = await onboard();
      const friend = await onboard();
      const event = await freshEvent(author);
      const momentId = await recordAndIndex(author, rareWord());
      await attach(momentId, event);

      await moments.setVisibility(momentId, author.userId, {
        visibility: "restricted",
        audience: [friend.userId],
      });
      await indexer.index("moment", momentId);

      // Being invited to see something is not the same as asking to be shown
      // it, and a recommendation would announce it to somebody who had not
      // thought about it in years.
      assert.equal(await offeredTo(friend, event, momentId), false);
    });

    it("never offers a private Moment, not even to its author", async () => {
      const author = await onboard();
      const event = await freshEvent(author);
      const momentId = await recordAndIndex(author, rareWord());
      await attach(momentId, event);

      await moments.setVisibility(momentId, author.userId, { visibility: "private" });
      await indexer.index("moment", momentId);

      assert.equal(await offeredTo(author, event, momentId), false);
    });

    it("never offers a Moment kept out of amplification, though search still finds it", async () => {
      const author = await onboard();
      const moderator = await onboardModerator();
      const event = await freshEvent(author);
      const word = rareWord();
      const momentId = await recordAndIndex(author, word);
      await attach(momentId, event);

      await app.inject({
        method: "PUT",
        url: `/moderation/subjects/moment/${momentId}/state`,
        headers: authed(moderator.accessToken),
        payload: { state: "restricted_from_amplification", reason: "integration test" },
      });
      await indexer.index("moment", momentId);

      const stranger = await onboard();

      // The state exists for exactly this: allowed to be reached, never put in
      // front of anybody. Until now nothing acted on it.
      assert.equal(await offeredTo(stranger, event, momentId), false);
      assert.ok((await searchIds(stranger.accessToken, word)).includes(momentId));
    });

    it("never offers an age-restricted Moment, to anybody, at any age", async () => {
      const author = await onboard();
      const moderator = await onboardModerator();
      const event = await freshEvent(author);
      const momentId = await recordAndIndex(author, rareWord());
      await attach(momentId, event);

      await app.inject({
        method: "PUT",
        url: `/moderation/subjects/moment/${momentId}/state`,
        headers: authed(moderator.accessToken),
        payload: { state: "age_restricted", reason: "integration test" },
      });
      await indexer.index("moment", momentId);

      const adult = await onboard();
      const teenager = await onboard(teenBirthday());

      // Search shows it to an adult; Discovery shows it to nobody. That gap is
      // the whole point of the phase.
      assert.equal(await offeredTo(adult, event, momentId), false);
      assert.equal(await offeredTo(teenager, event, momentId), false);
    });

    it("never offers history authored by somebody under eighteen", async () => {
      const adultAuthor = await onboard();
      const youngAuthor = await onboard(teenBirthday());
      const event = await freshEvent(adultAuthor);
      const theirs = await recordAndIndex(youngAuthor, rareWord());
      const mine = await recordAndIndex(adultAuthor, rareWord());
      await attach(theirs, event);
      await attach(mine, event);
      const stranger = await onboard();

      // Reachable by whoever they shared it with, never put in front of
      // strangers. The adult's Moment in the same Event proves the surface
      // works and the exclusion is about the author.
      assert.equal(await offeredTo(stranger, event, theirs), false);
      assert.equal(await offeredTo(stranger, event, mine), true);
    });

    it("hides recommendations in both directions once a Block exists", async () => {
      const one = await onboard();
      const two = await onboard();
      const event = await freshEvent(one);
      const theirs = await recordAndIndex(one, rareWord());
      const mine = await recordAndIndex(two, rareWord());
      await attach(theirs, event);
      await attach(mine, event);

      await app.inject({
        method: "POST",
        url: `/users/${two.userId}/block`,
        headers: authed(one.accessToken),
      });

      assert.equal(await offeredTo(two, event, theirs), false);
      assert.equal(await offeredTo(one, event, mine), false);
    });

    it("removes a suspended author's history from every surface", async () => {
      const author = await onboard();
      const moderator = await onboardModerator();
      const event = await freshEvent(author);
      const momentId = await recordAndIndex(author, rareWord());
      await attach(momentId, event);
      const stranger = await onboard();

      assert.equal(await offeredTo(stranger, event, momentId), true);

      await app.inject({
        method: "PUT",
        url: `/users/${author.userId}/suspension`,
        headers: authed(moderator.accessToken),
        payload: { suspended: true, reason: "integration test" },
      });
      await indexer.index("moment", momentId);

      assert.equal(await offeredTo(stranger, event, momentId), false);
    });

    it("never recommends anything that cannot also be found", async () => {
      // The claim of the whole phase, asserted directly: what may be
      // recommended is a strict subset of what may be found.
      const author = await onboard();
      const event = await freshEvent(author);
      const word = rareWord();
      const discoverableId = await recordAndIndex(author, word);
      const unlistedId = await recordAndIndex(author, word);
      await attach(discoverableId, event);
      await attach(unlistedId, event);

      await app.inject({
        method: "PUT",
        url: `/moments/${unlistedId}/discoverability`,
        headers: authed(author.accessToken),
        payload: { discoverable: false },
      });
      await indexer.index("moment", unlistedId);

      const stranger = await onboard();
      const offered = recommendedIds(await fromEvent(stranger.accessToken, event));
      const found = await searchIds(stranger.accessToken, word);

      for (const id of offered) {
        assert.ok(found.includes(id), `${id} was recommended but cannot be found`);
      }

      assert.ok(found.includes(unlistedId));
      assert.equal(offered.includes(unlistedId), false);
    });
  });

  describe("what a page looks like", () => {
    it("does not let one author fill a page", async () => {
      const prolific = await onboard();
      const other = await onboard();
      const event = await freshEvent(prolific);

      for (let i = 0; i < 8; i += 1) {
        await attach(await recordAndIndex(prolific, rareWord()), event);
      }

      await attach(await recordAndIndex(other, rareWord()), event);

      const offered = (await fromEvent(prolific.accessToken, event)).json().recommendations;
      const theirs = offered.filter(
        (one: { authorUserId: string }) => one.authorUserId === prolific.userId,
      );

      // A cap rather than a shuffle: some of theirs, not all of theirs.
      assert.ok(theirs.length < 8, `${theirs.length} of 8`);
      assert.ok(theirs.length > 0);
    });

    it("prefers more significant history", async () => {
      const author = await onboard();
      const event = await freshEvent(author);
      const plain = await recordAndIndex(author, rareWord());
      const notable = await recordAndIndex(author, rareWord());

      await attach(plain, event);
      await attach(notable, event);
      await makeSignificant(plain, 1);
      await makeSignificant(notable, 90);

      // Scoped to an Event nothing else belongs to. Asserted against Explore
      // this would have been conditional on both appearing in the first fifty
      // of ten thousand Moments — a test that passes by not looking.
      const page = recommendedIds(await fromEvent(author.accessToken, event));

      assert.deepEqual(page, [notable, plain]);
    });

    it("orders by significance and not by how much was said about it", async () => {
      const author = await onboard();
      const reactor = await onboard();
      const event = await freshEvent(author);
      const significant = await recordAndIndex(author, rareWord());
      const popular = await recordAndIndex(author, rareWord());

      await attach(significant, event);
      await attach(popular, event);
      await makeSignificant(significant, 90);

      await app.inject({
        method: "PUT",
        url: `/moments/${popular}/reaction`,
        headers: authed(reactor.accessToken),
        payload: { kind: "loved" },
      });
      await app.inject({
        method: "POST",
        url: `/moments/${popular}/comments`,
        headers: authed(reactor.accessToken),
        payload: { body: "Something said out loud" },
      });
      await indexer.index("moment", popular);

      // Engagement is not a signal, and the ranking code cannot reach one.
      assert.deepEqual(recommendedIds(await fromEvent(author.accessToken, event)), [
        significant,
        popular,
      ]);
    });

    it("gives the same page twice", async () => {
      const author = await onboard();
      const event = await freshEvent(author);

      for (let i = 0; i < 3; i += 1) {
        await attach(await recordAndIndex(author, rareWord()), event);
      }

      assert.deepEqual(
        recommendedIds(await fromEvent(author.accessToken, event)),
        recommendedIds(await fromEvent(author.accessToken, event)),
      );
    });
  });

  describe("explore", () => {
    it("returns a well-formed page of public history", async () => {
      const seeker = await onboard();

      const response = await explore(seeker.accessToken, { limit: 10 });

      assert.equal(response.statusCode, 200, response.body);
      assert.ok(response.json().recommendations.length > 0);
      assert.ok(response.json().recommendations.length <= 10);
    });

    it("says the same reason for everything it offers", async () => {
      const seeker = await onboard();

      for (const one of (await explore(seeker.accessToken, { limit: 20 })).json().recommendations) {
        assert.deepEqual(one.because, ["significant"]);
      }
    });

    it("lets no author dominate a page", async () => {
      const seeker = await onboard();
      const counts = new Map<string, number>();

      for (const one of (await explore(seeker.accessToken, { limit: 50 })).json()
        .recommendations as { authorUserId: string }[]) {
        counts.set(one.authorUserId, (counts.get(one.authorUserId) ?? 0) + 1);
      }

      // Asserted over whatever the shared database happens to hold, which is
      // the honest test of a cap: it has to hold for real data rather than for
      // a set arranged to make it hold.
      for (const [author, count] of counts) {
        assert.ok(count <= 3, `${author} took ${count} of the page`);
      }
    });

    it("offers everybody the same page, having no profile of anybody", async () => {
      const one = await onboard();
      const two = await onboard();

      // Non-personalised, which is also the cold-start answer: a new account
      // sees what an old one sees, because neither page was assembled from
      // anything either of them did.
      assert.deepEqual(
        recommendedIds(await explore(one.accessToken, { limit: 20 })),
        recommendedIds(await explore(two.accessToken, { limit: 20 })),
      );
    });
  });

  describe("related history", () => {
    it("offers a Moment somebody claimed is related", async () => {
      const author = await onboard();
      const one = await recordAndIndex(author, rareWord());
      const two = await recordAndIndex(author, rareWord());

      // Asserted directly. What is under test is whether Discovery honours a
      // claim, not whether the endpoint that records one works — that has its
      // own suite, and mounting the service here would widen this harness for
      // no gain.
      await assertRelationship(author.userId, one, two);

      const response = await app.inject({
        method: "GET",
        url: `/moments/${one}/related?limit=50`,
        headers: authed(author.accessToken),
      });

      assert.ok(recommendedIds(response).includes(two));
    });

    it("never offers the Moment being asked about", async () => {
      const author = await onboard();
      const momentId = await recordAndIndex(author, rareWord());

      const response = await app.inject({
        method: "GET",
        url: `/moments/${momentId}/related?limit=50`,
        headers: authed(author.accessToken),
      });

      assert.equal(recommendedIds(response).includes(momentId), false);
    });

    it("applies the same floors as every other surface", async () => {
      const author = await onboard();
      const one = await recordAndIndex(author, rareWord());
      const two = await recordAndIndex(author, rareWord());

      await assertRelationship(author.userId, one, two);
      await app.inject({
        method: "PUT",
        url: `/moments/${two}/discoverability`,
        headers: authed(author.accessToken),
        payload: { discoverable: false },
      });
      await indexer.index("moment", two);

      const response = await app.inject({
        method: "GET",
        url: `/moments/${one}/related?limit=50`,
        headers: authed(author.accessToken),
      });

      // A surface added later inherits the rule rather than restating it.
      assert.equal(recommendedIds(response).includes(two), false);
    });
  });

  describe("history near a place", () => {
    const LAT = 41.9028;
    const LON = 12.4964;

    const withPlace = async (
      author: { accessToken: string; userId: string },
      disclosure: string,
    ) => {
      const momentId = await recordAndIndex(author, rareWord(), {
        locationDisclosure: disclosure,
      });
      const locationId = randomUUID();

      await database.dataSource.query(
        `INSERT INTO locations (location_id, recorded_by_user_id, name, latitude, longitude,
                                precision, source_reference, source, created_at)
         VALUES ($1, $2, 'Somewhere', $3, $4, 'exact', $5, 'explicit-selection', now())`,
        [locationId, author.userId, LAT, LON, locationId],
      );
      await database.dataSource.query(
        `INSERT INTO moment_locations (moment_id, location_id, origin, created_at)
         VALUES ($1, $2, 'user-asserted', now())`,
        [momentId, locationId],
      );
      await indexer.index("moment", momentId);

      return { momentId, locationId };
    };

    const nearby = async (accessToken: string, radius: number) =>
      app.inject({
        method: "GET",
        url: `/discovery/nearby?lat=${LAT}&lon=${LON}&radius=${radius}&limit=50`,
        headers: authed(accessToken),
      });

    it("offers history near a position", async () => {
      const author = await onboard();
      const { momentId } = await withPlace(author, "exact");

      assert.ok(recommendedIds(await nearby(author.accessToken, 1_000)).includes(momentId));
    });

    it("answers at the granularity the author disclosed", async () => {
      const author = await onboard();
      const { momentId } = await withPlace(author, "city");

      // Nothing finer than a region cell was ever stored, so a street-sized
      // view cannot reach it. The same rule Search follows.
      assert.equal(recommendedIds(await nearby(author.accessToken, 100)).includes(momentId), false);
      assert.ok(recommendedIds(await nearby(author.accessToken, 500_000)).includes(momentId));
    });

    it("never offers a Moment whose place is hidden", async () => {
      const author = await onboard();
      const { momentId } = await withPlace(author, "hidden");

      for (const radius of [100, 5_000, 500_000]) {
        assert.equal(
          recommendedIds(await nearby(author.accessToken, radius)).includes(momentId),
          false,
          `radius ${radius}`,
        );
      }
    });

    it("offers history at a named place", async () => {
      const author = await onboard();
      const { momentId, locationId } = await withPlace(author, "exact");

      const response = await app.inject({
        method: "GET",
        url: `/discovery/locations/${locationId}?limit=50`,
        headers: authed(author.accessToken),
      });

      assert.ok(recommendedIds(response).includes(momentId));
    });
  });
});
