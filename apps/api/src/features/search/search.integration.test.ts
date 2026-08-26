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
import { MomentRepository } from "../moments/moment.repository.js";
import { MomentService } from "../moments/moment.service.js";
import { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import { FollowRepository } from "../social/follow.repository.js";
import { FollowService } from "../social/follow.service.js";
import { UploadRepository } from "../uploads/upload.repository.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { SearchIndexer } from "./search.indexer.js";
import { SearchRepository } from "./search.repository.js";
import { SearchSourceRepository } from "./search-source.repository.js";
import { PostgresSearchRetrieval } from "./search.retrieval.js";
import { SearchService } from "./search.service.js";

/**
 * Search, against real infrastructure.
 *
 * The claims worth testing here are all about who may find what. Everything
 * else — how words are split, how a radius picks a tier, what a cursor carries
 * — is pure and covered next door; what cannot be covered next door is whether
 * the eligibility rule survives contact with a real query.
 *
 * Indexing is driven directly rather than through the worker. What is under
 * test is retrieval, and going through Kafka would test the broker.
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
  messaging: { brokers: ["localhost:9092"], clientId: "search-integration" },
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

/** Fifteen today: old enough for an account, not for everything. */
const teenBirthday = () => {
  const born = new Date();

  born.setUTCFullYear(born.getUTCFullYear() - 15);

  return born.toISOString().slice(0, 10);
};

const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

/** A word nothing else in the shared database will contain. */
const rareWord = () => `zq${randomUUID().replaceAll("-", "").slice(0, 10)}`;

describe("search", () => {
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
    const sources = new SearchSourceRepository(database.dataSource);

    indexer = new SearchIndexer(
      database.dataSource,
      new SearchRepository(database.dataSource),
      sources,
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

  const summer = {
    start: "1998-06-01T00:00:00.000Z",
    end: "1998-08-31T23:59:59.000Z",
    precision: "month",
  } as const;

  /** Record a Moment and index it, which is what makes it findable. */
  const recordAndIndex = async (
    author: { accessToken: string; userId: string },
    caption: string,
    over: Record<string, unknown> = {},
  ) => {
    const uploadId = await createReadyUpload(database.dataSource, author.userId);
    const moment = await moments.record(author.userId, {
      caption,
      occurrence: summer,
      occurrenceOffsetMinutes: 0,
      uploadIds: [uploadId],
      visibility: "public",
      locationDisclosure: "exact",
      ...over,
    } as never);

    await indexer.index("moment", moment.momentId);

    return moment.momentId;
  };

  const search = async (accessToken: string, params: Record<string, string | number>) =>
    app.inject({
      method: "GET",
      url: `/search?${new URLSearchParams(
        Object.entries(params).map(([key, value]): [string, string] => [key, String(value)]),
      ).toString()}`,
      headers: authed(accessToken),
    });

  const idsFrom = (response: { json(): { results: { entityId: string }[] } }) =>
    response.json().results.map((result) => result.entityId);

  describe("finding things", () => {
    it("finds a public Moment by a word in its caption", async () => {
      const author = await onboard();
      const word = rareWord();
      const momentId = await recordAndIndex(author, `A day at ${word}`);
      const stranger = await onboard();

      const response = await search(stranger.accessToken, { q: word });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(idsFrom(response), [momentId]);
      assert.equal(response.json().total, 1);
    });

    it("says what each result is", async () => {
      const author = await onboard();
      const word = rareWord();
      await recordAndIndex(author, `A day at ${word}`);

      const response = await search(author.accessToken, { q: word });

      // Nothing is flattened into an undifferentiated list of media posts.
      assert.equal(response.json().results[0].entityType, "moment");
    });

    it("returns no score and no significance number", async () => {
      const author = await onboard();
      const word = rareWord();
      await recordAndIndex(author, `A day at ${word}`);

      const response = await search(author.accessToken, { q: word });
      const result = response.json().results[0];

      // A number beside a result reads as a judgement about the past whatever
      // it is labelled.
      assert.equal(result.score, undefined);
      assert.equal(result.significance, undefined);
    });

    it("narrows to one kind of thing when asked", async () => {
      const author = await onboard();
      const word = rareWord();
      await recordAndIndex(author, `A day at ${word}`);

      const response = await search(author.accessToken, { q: word, type: "user" });

      assert.deepEqual(response.json().results, []);
      assert.equal(response.json().total, 0);
    });

    it("returns nothing rather than something loosely related", async () => {
      const stranger = await onboard();

      const response = await search(stranger.accessToken, { q: rareWord() });

      // No result is preferable to fictional history.
      assert.deepEqual(response.json().results, []);
      assert.equal(response.json().total, 0);
      assert.equal(response.json().nextCursor, undefined);
    });

    it("says why a result matched", async () => {
      const author = await onboard();
      const word = rareWord();
      await recordAndIndex(author, `A day at ${word}`);

      const response = await search(author.accessToken, { q: word });

      assert.ok(response.json().results[0].matchedOn.length > 0);
    });

    it("keeps occurrence precision in the result", async () => {
      const author = await onboard();
      const word = rareWord();
      await recordAndIndex(author, `A day at ${word}`);

      const response = await search(author.accessToken, { q: word });

      // Nothing invents a day for a summer nobody dated more precisely.
      assert.equal(response.json().results[0].occurrence.precision, "month");
    });
  });

  describe("who may find what", () => {
    it("hides a private Moment from a stranger and keeps it for its author", async () => {
      const author = await onboard();
      const word = rareWord();
      const momentId = await recordAndIndex(author, `A day at ${word}`, {
        visibility: "private",
      });
      const stranger = await onboard();

      assert.deepEqual(idsFrom(await search(stranger.accessToken, { q: word })), []);
      // Searching your own private history is the whole reason searchability
      // and visibility are separate columns.
      assert.deepEqual(idsFrom(await search(author.accessToken, { q: word })), [momentId]);
    });

    it("shows a restricted Moment to its audience and to nobody else", async () => {
      const author = await onboard();
      const friend = await onboard();
      const stranger = await onboard();
      const word = rareWord();
      const momentId = await recordAndIndex(author, `A day at ${word}`);

      await moments.setVisibility(momentId, author.userId, {
        visibility: "restricted",
        audience: [friend.userId],
      });
      await indexer.index("moment", momentId);

      assert.deepEqual(idsFrom(await search(friend.accessToken, { q: word })), [momentId]);
      assert.deepEqual(idsFrom(await search(stranger.accessToken, { q: word })), []);
    });

    it("hides results in both directions once a Block exists", async () => {
      const author = await onboard();
      const other = await onboard();
      const word = rareWord();
      const theirs = await recordAndIndex(author, `A day at ${word}`);
      const mine = await recordAndIndex(other, `Another day at ${word}`);

      await app.inject({
        method: "POST",
        url: `/users/${other.userId}/block`,
        headers: authed(author.accessToken),
      });

      assert.equal(idsFrom(await search(other.accessToken, { q: word })).includes(theirs), false);
      assert.equal(idsFrom(await search(author.accessToken, { q: word })).includes(mine), false);
    });

    it("hides a suspended author's Moments while they still find their own", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const moderator = await onboardModerator();
      const word = rareWord();
      const momentId = await recordAndIndex(author, `A day at ${word}`);

      await app.inject({
        method: "PUT",
        url: `/users/${author.userId}/suspension`,
        headers: authed(moderator.accessToken),
        payload: { suspended: true, reason: "integration test" },
      });

      assert.deepEqual(idsFrom(await search(stranger.accessToken, { q: word })), []);
      assert.deepEqual(idsFrom(await search(author.accessToken, { q: word })), [momentId]);
    });

    it("does not find a deactivated account", async () => {
      const account = await onboard();
      const handle = `zq${randomUUID().replaceAll("-", "").slice(0, 10)}`;

      await app.inject({
        method: "PUT",
        url: "/users/me/handle",
        headers: authed(account.accessToken),
        payload: { handle },
      });
      await indexer.index("user", account.userId);

      const seeker = await onboard();

      assert.equal(idsFrom(await search(seeker.accessToken, { q: handle })).length, 1);

      await app.inject({
        method: "POST",
        url: "/users/me/deactivate",
        headers: authed(account.accessToken),
      });
      await indexer.index("user", account.userId);

      // Absent from Search as they are absent from the public profile view.
      assert.deepEqual(idsFrom(await search(seeker.accessToken, { q: handle })), []);
    });

    it("hides an age-restricted Moment from somebody under eighteen", async () => {
      const author = await onboard();
      const teenager = await onboard(teenBirthday());
      const adult = await onboard();
      const moderator = await onboardModerator();
      const word = rareWord();
      const momentId = await recordAndIndex(author, `A day at ${word}`);

      await app.inject({
        method: "PUT",
        url: `/moderation/subjects/moment/${momentId}/state`,
        headers: authed(moderator.accessToken),
        payload: { state: "age_restricted", reason: "integration test" },
      });
      await indexer.index("moment", momentId);

      assert.deepEqual(idsFrom(await search(teenager.accessToken, { q: word })), []);
      // And an adult still finds it, which the first version of the index made
      // impossible by refusing it before anybody knew who was asking.
      assert.deepEqual(idsFrom(await search(adult.accessToken, { q: word })), [momentId]);
    });

    it("does not find a removed Moment", async () => {
      const author = await onboard();
      const moderator = await onboardModerator();
      const word = rareWord();
      const momentId = await recordAndIndex(author, `A day at ${word}`);

      await app.inject({
        method: "PUT",
        url: `/moderation/subjects/moment/${momentId}/state`,
        headers: authed(moderator.accessToken),
        payload: { state: "removed", reason: "integration test" },
      });
      await indexer.index("moment", momentId);

      assert.deepEqual(idsFrom(await search(author.accessToken, { q: word })), []);
    });

    it("does not find a Moment withheld during review", async () => {
      const author = await onboard();
      const moderator = await onboardModerator();
      const word = rareWord();
      const momentId = await recordAndIndex(author, `A day at ${word}`);

      await app.inject({
        method: "PUT",
        url: `/moderation/subjects/moment/${momentId}/state`,
        headers: authed(moderator.accessToken),
        payload: { state: "temporarily_unavailable", reason: "integration test" },
      });
      await indexer.index("moment", momentId);

      assert.deepEqual(idsFrom(await search(author.accessToken, { q: word })), []);
    });

    it("narrows a moderated Moment to its audience whatever its author chose", async () => {
      const author = await onboard();
      const friend = await onboard();
      const stranger = await onboard();
      const moderator = await onboardModerator();
      const word = rareWord();
      const momentId = await recordAndIndex(author, `A day at ${word}`);

      await moments.setVisibility(momentId, author.userId, {
        visibility: "restricted",
        audience: [friend.userId],
      });

      await app.inject({
        method: "PUT",
        url: `/moderation/subjects/moment/${momentId}/state`,
        headers: authed(moderator.accessToken),
        payload: { state: "restricted_to_authorized_audience", reason: "integration test" },
      });
      await indexer.index("moment", momentId);

      assert.deepEqual(idsFrom(await search(friend.accessToken, { q: word })), [momentId]);
      assert.deepEqual(idsFrom(await search(stranger.accessToken, { q: word })), []);
    });

    it("counts only what the Viewer may see", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const word = rareWord();

      await recordAndIndex(author, `Public ${word}`);
      await recordAndIndex(author, `Private ${word}`, { visibility: "private" });

      const theirs = await search(stranger.accessToken, { q: word });
      const own = await search(author.accessToken, { q: word });

      // A count computed before eligibility would report how much was withheld,
      // which is a disclosure in itself.
      assert.equal(theirs.json().total, 1);
      assert.equal(own.json().total, 2);
    });

    it("fills a page even when ineligible results sit between the eligible ones", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const word = rareWord();

      // Interleaved deliberately: filtering after paginating would return a
      // short page here and leak the gaps.
      for (let i = 0; i < 6; i += 1) {
        await recordAndIndex(author, `${word} number ${i}`, {
          visibility: i % 2 === 0 ? "public" : "private",
        });
      }

      const response = await search(stranger.accessToken, { q: word, limit: 3 });

      assert.equal(response.json().results.length, 3);
      assert.equal(response.json().total, 3);
    });
  });

  describe("ordering and paging", () => {
    it("gives the same answer in the same order twice", async () => {
      const author = await onboard();
      const word = rareWord();

      for (let i = 0; i < 5; i += 1) {
        await recordAndIndex(author, `${word} number ${i}`);
      }

      const once = idsFrom(await search(author.accessToken, { q: word }));
      const again = idsFrom(await search(author.accessToken, { q: word }));

      assert.deepEqual(once, again);
    });

    it("orders chronologically when asked, ignoring relevance", async () => {
      const author = await onboard();
      const word = rareWord();

      const older = await recordAndIndex(author, `${word} older`, {
        occurrence: { start: "1990-01-01T00:00:00.000Z", end: "1990-01-01T00:00:00.000Z", precision: "instant" },
      });
      const newer = await recordAndIndex(author, `${word}`, {
        occurrence: { start: "2010-01-01T00:00:00.000Z", end: "2010-01-01T00:00:00.000Z", precision: "instant" },
      });

      // The newer one is also the better textual match, so relevance would put
      // it first either way. Oldest-first is what proves relevance plays no
      // part at all.
      assert.deepEqual(idsFrom(await search(author.accessToken, { q: word, sort: "occurrence_old" })), [
        older,
        newer,
      ]);
      assert.deepEqual(idsFrom(await search(author.accessToken, { q: word, sort: "occurrence_new" })), [
        newer,
        older,
      ]);
    });

    it("pages without repeating or skipping", async () => {
      const author = await onboard();
      const word = rareWord();

      for (let i = 0; i < 5; i += 1) {
        await recordAndIndex(author, `${word} number ${i}`);
      }

      const first = await search(author.accessToken, { q: word, limit: 2 });
      const second = await search(author.accessToken, {
        q: word,
        limit: 2,
        cursor: first.json().nextCursor,
      });
      const third = await search(author.accessToken, {
        q: word,
        limit: 2,
        cursor: second.json().nextCursor,
      });

      const seen = [...idsFrom(first), ...idsFrom(second), ...idsFrom(third)];

      assert.equal(seen.length, 5);
      assert.equal(new Set(seen).size, 5);
      assert.equal(third.json().nextCursor, undefined);
    });

    it("refuses a cursor from a different search", async () => {
      const author = await onboard();
      const word = rareWord();

      for (let i = 0; i < 4; i += 1) {
        await recordAndIndex(author, `${word} number ${i}`);
      }

      const first = await search(author.accessToken, { q: word, limit: 2 });
      const wrong = await search(author.accessToken, {
        q: "something else entirely",
        limit: 2,
        cursor: first.json().nextCursor,
      });

      // Refused rather than silently restarted, which would look to the caller
      // like results repeating.
      assert.equal(wrong.statusCode, 400, wrong.body);
    });

    it("refuses a cursor that is not one this search issued", async () => {
      const author = await onboard();

      const response = await search(author.accessToken, { q: rareWord(), cursor: "nonsense" });

      assert.equal(response.statusCode, 400, response.body);
    });

    it("offers no cursor when everything fits on one page", async () => {
      const author = await onboard();
      const word = rareWord();
      await recordAndIndex(author, `A day at ${word}`);

      assert.equal((await search(author.accessToken, { q: word })).json().nextCursor, undefined);
    });
  });

  describe("matching", () => {
    it("finds a Moment by a word in its place or its Event", async () => {
      const author = await onboard();
      const word = rareWord();
      const momentId = await recordAndIndex(author, "An ordinary caption");

      // The place and the Events are indexed into the body, so somebody
      // searching for where it happened finds it.
      await database.dataSource.query(
        "UPDATE search_documents SET body = body || $2, search_vector = search_vector || to_tsvector('simple', $2) WHERE entity_id = $1",
        [momentId, ` ${word}`],
      );

      assert.deepEqual(idsFrom(await search(author.accessToken, { q: word })), [momentId]);
    });

    it("ranks an exact title match above a passing mention", async () => {
      const author = await onboard();
      const word = rareWord();

      const mention = await recordAndIndex(author, `We talked about ${word} for hours`);
      const exact = await recordAndIndex(author, word);

      assert.deepEqual(idsFrom(await search(author.accessToken, { q: word })), [exact, mention]);
    });

    it("still finds something when the word is misspelled", async () => {
      const author = await onboard();
      const word = rareWord();
      const momentId = await recordAndIndex(author, word);
      const misspelled = `${word.slice(0, -2)}xx`;

      // A historically unusual spelling may be the correct one, so a near miss
      // retrieves rather than rewriting what somebody typed.
      //
      // Containment rather than equality: fuzzy matching is fuzzy, and the
      // shared database holds words from every earlier run. What matters is
      // that the misspelling still reaches the thing meant.
      assert.ok(idsFrom(await search(author.accessToken, { q: misspelled })).includes(momentId));
    });

    it("finds a Moment whose date is known only to the month", async () => {
      const author = await onboard();
      const word = rareWord();
      const momentId = await recordAndIndex(author, `A day at ${word}`);

      const response = await search(author.accessToken, {
        q: word,
        from: "1998-01-01T00:00:00.000Z",
        to: "1998-12-31T23:59:59.000Z",
      });

      // Overlap, not containment. "Summer 1998" belongs in a search for 1998.
      assert.deepEqual(idsFrom(response), [momentId]);
      assert.equal(response.json().results[0].occurrence.precision, "month");
    });

    it("excludes a Moment outside the window", async () => {
      const author = await onboard();
      const word = rareWord();
      await recordAndIndex(author, `A day at ${word}`);

      const response = await search(author.accessToken, {
        q: word,
        from: "2020-01-01T00:00:00.000Z",
        to: "2020-12-31T23:59:59.000Z",
      });

      assert.deepEqual(idsFrom(response), []);
    });

    it("narrows to one person's history", async () => {
      const author = await onboard();
      const other = await onboard();
      const word = rareWord();
      const theirs = await recordAndIndex(author, `A day at ${word}`);
      await recordAndIndex(other, `Another day at ${word}`);

      assert.deepEqual(
        idsFrom(await search(author.accessToken, { q: word, creator: author.userId })),
        [theirs],
      );
    });

    it("refuses a search with nothing to search for", async () => {
      const seeker = await onboard();

      assert.equal((await search(seeker.accessToken, { limit: 10 })).statusCode, 400);
    });

    it("refuses a radius with no position", async () => {
      const seeker = await onboard();

      assert.equal((await search(seeker.accessToken, { q: "x", radius: 500 })).statusCode, 400);
    });
  });

  describe("searching near a place", () => {
    /** Somewhere nothing else in the shared database sits. */
    const LAT = 12.3456;
    const LON = 98.7654;

    const withPlace = async (
      author: { accessToken: string; userId: string },
      caption: string,
      disclosure: string,
      latitude = LAT,
      longitude = LON,
    ) => {
      const momentId = await recordAndIndex(author, caption, { locationDisclosure: disclosure });

      // The place is set directly: what is under test is retrieval by cell, not
      // the geocoding path that produced the coordinates.
      const locationId = randomUUID();
      await database.dataSource.query(
        `INSERT INTO locations (location_id, recorded_by_user_id, name, latitude, longitude,
                                precision, source_reference, source, created_at)
         VALUES ($1, $2, 'Somewhere', $3, $4, 'exact', $5, 'explicit-selection', now())`,
        [locationId, author.userId, latitude, longitude, locationId],
      );
      await database.dataSource.query(
        `INSERT INTO moment_locations (moment_id, location_id, origin, created_at)
         VALUES ($1, $2, 'user-asserted', now())`,
        [momentId, locationId],
      );
      await indexer.index("moment", momentId);

      return momentId;
    };

    it("finds a Moment near the point searched from", async () => {
      const author = await onboard();
      const word = rareWord();
      const momentId = await withPlace(author, `A day at ${word}`, "exact");

      const response = await search(author.accessToken, {
        q: word,
        lat: LAT,
        lon: LON,
        radius: 1_000,
      });

      assert.deepEqual(idsFrom(response), [momentId]);
    });

    it("does not find one on the other side of the world", async () => {
      const author = await onboard();
      const word = rareWord();
      await withPlace(author, `A day at ${word}`, "exact");

      const response = await search(author.accessToken, {
        q: word,
        lat: -33.8688,
        lon: 151.2093,
        radius: 1_000,
      });

      assert.deepEqual(idsFrom(response), []);
    });

    it("says which granularity actually answered", async () => {
      const author = await onboard();
      const word = rareWord();
      await withPlace(author, `A day at ${word}`, "exact");

      const fine = await search(author.accessToken, { q: word, lat: LAT, lon: LON, radius: 20 });
      const coarse = await search(author.accessToken, {
        q: word,
        lat: LAT,
        lon: LON,
        radius: 500_000,
      });

      // A radius cannot always be honoured exactly, and rounding it away
      // silently would be the geographic version of inventing a date.
      assert.equal(fine.json().geoPrecision, "exact");
      assert.equal(coarse.json().geoPrecision, "region");
    });

    it("says nothing about granularity when the search was not geographic", async () => {
      const author = await onboard();
      const word = rareWord();
      await recordAndIndex(author, `A day at ${word}`);

      assert.equal((await search(author.accessToken, { q: word })).json().geoPrecision, undefined);
    });

    it("finds a city-disclosed Moment by a city-sized search and not a street-sized one", async () => {
      const author = await onboard();
      const word = rareWord();
      const momentId = await withPlace(author, `A day at ${word}`, "city");

      const wide = await search(author.accessToken, {
        q: word,
        lat: LAT,
        lon: LON,
        radius: 500_000,
      });
      const narrow = await search(author.accessToken, {
        q: word,
        lat: LAT,
        lon: LON,
        radius: 100,
      });

      // Nothing finer than a region cell was stored, so a street-sized search
      // cannot answer. That is the disclosure working.
      assert.deepEqual(idsFrom(wide), [momentId]);
      assert.deepEqual(idsFrom(narrow), []);
    });

    it("never matches a Moment whose place is hidden, even for its author", async () => {
      const author = await onboard();
      const word = rareWord();
      await withPlace(author, `A day at ${word}`, "hidden");

      for (const radius of [100, 5_000, 500_000]) {
        const response = await search(author.accessToken, {
          q: word,
          lat: LAT,
          lon: LON,
          radius,
        });

        assert.deepEqual(idsFrom(response), [], `radius ${radius}`);
      }
    });

    it("finds a place just across a cell boundary", async () => {
      const author = await onboard();
      const word = rareWord();
      // Far enough to be a different cell at the finest tier, close enough to
      // be a neighbour. Without neighbour expansion this is silently missed.
      const momentId = await withPlace(author, `A day at ${word}`, "exact", LAT + 0.0004, LON);

      const response = await search(author.accessToken, {
        q: word,
        lat: LAT,
        lon: LON,
        radius: 100,
      });

      assert.deepEqual(idsFrom(response), [momentId]);
    });
  });

  describe("a result is not a permission", () => {
    it("refuses to open something that stopped being visible after it was found", async () => {
      const author = await onboard();
      const friend = await onboard();
      const word = rareWord();
      const momentId = await recordAndIndex(author, `A day at ${word}`);

      assert.deepEqual(idsFrom(await search(friend.accessToken, { q: word })), [momentId]);

      await moments.setVisibility(momentId, author.userId, { visibility: "private" });

      // The index still holds it as public until the worker catches up. Opening
      // reauthorizes against current state, so the stale entry cannot become
      // access.
      const opened = await app.inject({
        method: "GET",
        url: `/moments/${momentId}`,
        headers: authed(friend.accessToken),
      });

      assert.equal(opened.statusCode, 404, opened.body);
    });
  });
});
