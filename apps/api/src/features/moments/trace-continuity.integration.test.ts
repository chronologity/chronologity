import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { MAILPIT, testAppConfig } from "../../testing/app-config.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { deliverThroughBroker } from "../../testing/broker.js";
import { createReadyUpload } from "../../testing/fixtures.js";
import { SearchIndexer } from "../search/search.indexer.js";
import { SearchRepository } from "../search/search.repository.js";
import { SearchSourceRepository } from "../search/search-source.repository.js";
import {
  indexFromEvent,
  SEARCH_INDEXER_BOUNDARIES,
} from "../../workers/search-indexer/index-event.js";
import { LocationRepository } from "../locations/location.repository.js";
import { LocationService } from "../locations/location.service.js";
import { ModerationRepository } from "../moderation/moderation.repository.js";
import { MomentCommentRepository } from "./moment-comment.repository.js";
import { MomentRepository } from "./moment.repository.js";
import { MomentService } from "./moment.service.js";
import { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import { RealWorldEventService } from "../real-world-events/real-world-event.service.js";
import { FollowRepository } from "../social/follow.repository.js";
import { UploadRepository } from "../uploads/upload.repository.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { createPlaceSearchClient } from "../../integrations/places/place-search-client.js";

/**
 * Following one request from the client to the worker.
 *
 * `traceId` is what joins "somebody did this" to the event it published and the
 * work that event caused. Until now it was carried by an optional parameter,
 * and a service handed no context answered with `randomUUID()` — so a caller
 * that forgot did not fail, it started a second trace and severed the chain.
 * Seven callers had forgotten: Locations, real-world Events, and five of the
 * User routes, which between them account for `LocationRecorded`,
 * `RealWorldEventRecorded`, `UserCreated`, `UserProfileChanged` and
 * `UserStatusChanged`.
 *
 * The parameter is now required, so that particular mistake no longer compiles.
 * What a type cannot say is that the identifier actually arrives, which is what
 * this asserts: one trace, given by the client, found on the outbox row, on the
 * envelope that crossed Kafka, and in the message the worker handled.
 *
 * Requires `pnpm infra:up`. Run with `pnpm test:integration`.
 */

const config = testAppConfig("trace-continuity-integration");

const ADULT = "1990-04-12";
const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

const summer = {
  start: "1998-06-01T00:00:00.000Z",
  end: "1998-08-31T23:59:59.000Z",
  precision: "month",
} as const;

describe("a trace that has to survive every hop", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;
  let indexer: SearchIndexer;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);
    indexer = new SearchIndexer(
      database.dataSource,
      new SearchRepository(database.dataSource),
      new SearchSourceRepository(database.dataSource),
    );

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

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, new UserRepository(database.dataSource), {
        minimumAgeYears: config.minimumAgeYears,
      }),
      moments,
      locations: new LocationService(
        database.dataSource,
        new LocationRepository(database.dataSource),
        createPlaceSearchClient(config.places),
      ),
      realWorldEvents: new RealWorldEventService(
        database.dataSource,
        new RealWorldEventRepository(database.dataSource),
        new LocationRepository(database.dataSource),
      ),
    });
  });

  afterAll(async () => {
    await app.close();
    await authentication.close();
    await database.close();
  });

  const authed = (accessToken: string, traceId?: string) => ({
    authorization: `Bearer ${accessToken}`,
    ...(traceId === undefined ? {} : { "x-trace-id": traceId }),
  });

  /** Read the most recent sign-in link Mailpit received for an address. */
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

  /** Somebody signed in, created under a trace of their own. */
  const onboard = async (traceId: string) => {
    const email = uniqueEmail();
    await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
    const session = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token: await readLinkFor(email) },
    });

    assert.equal(session.statusCode, 201, session.body);

    const credentials = session.json();
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(credentials.accessToken, traceId),
      payload: { handle: uniqueHandle(), displayName: "Traced", dateOfBirth: ADULT },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { accessToken: credentials.accessToken as string, userId: created.json().userId };
  };

  /** What the outbox recorded about one aggregate. */
  const announcementsFor = async (aggregateId: string) => {
    const rows: { event_type: string; metadata: { traceId?: string } }[] =
      await database.dataSource.query(
        "SELECT event_type, metadata FROM outbox_messages WHERE aggregate_id = $1",
        [aggregateId],
      );

    return rows;
  };

  describe("the paths that were dropping it", () => {
    it("carries the trace from a request into what recording a Location announces", async () => {
      const traceId = randomUUID();
      const person = await onboard(randomUUID());

      const created = await app.inject({
        method: "POST",
        url: "/locations",
        headers: authed(person.accessToken, traceId),
        payload: { name: "Somewhere in particular", precision: "exact", coordinates: { latitude: 51.5, longitude: -0.12 } },
      });

      assert.equal(created.statusCode, 201, created.body);

      const announced = await announcementsFor(created.json().locationId);

      assert.equal(announced.length, 1, "recording a Location announced nothing");
      assert.equal(
        announced[0]?.metadata.traceId,
        traceId,
        "the Location was announced under a trace the request never had",
      );
    });

    it("carries it into what recording a real-world Event announces", async () => {
      const traceId = randomUUID();
      const person = await onboard(randomUUID());

      const created = await app.inject({
        method: "POST",
        url: "/real-world-events",
        headers: authed(person.accessToken, traceId),
        payload: { name: `Event ${randomUUID().slice(0, 8)}`, occurrence: summer },
      });

      assert.equal(created.statusCode, 201, created.body);

      const announced = await announcementsFor(created.json().realWorldEventId);

      assert.equal(announced.length, 1);
      assert.equal(announced[0]?.metadata.traceId, traceId);
    });

    it("carries it into what creating an account announces", async () => {
      const traceId = randomUUID();
      const person = await onboard(traceId);

      const announced = await announcementsFor(person.userId);

      assert.ok(announced.length > 0, "creating an account announced nothing");
      assert.equal(announced[0]?.metadata.traceId, traceId);
    });
  });

  describe("all the way to the worker", () => {
    it("keeps one identifier from the client to what the indexer handles", async () => {
      const traceId = randomUUID();
      const person = await onboard(randomUUID());
      const uploadId = await createReadyUpload(database.dataSource, person.userId);

      const recorded = await app.inject({
        method: "POST",
        url: "/moments",
        headers: authed(person.accessToken, traceId),
        payload: {
          caption: "Followed all the way",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [uploadId],
          visibility: "public",
        },
      });

      assert.equal(recorded.statusCode, 201, recorded.body);

      const momentId = recorded.json().momentId as string;

      // Hop one: the response says which trace answered.
      assert.equal(recorded.headers["x-trace-id"], traceId);

      // Hop two: the outbox row the Moment's own transaction wrote.
      const announced = await announcementsFor(momentId);

      assert.equal(announced[0]?.metadata.traceId, traceId);

      // Hops three and four: published to a real broker, and handed to the real
      // worker, which is where a correlation identifier either arrives or does
      // not.
      const seen: string[] = [];

      await deliverThroughBroker({
        dataSource: database.dataSource,
        boundaries: SEARCH_INDEXER_BOUNDARIES,
        aggregateId: momentId,
        handler: async (event) => {
          seen.push(event.envelope.correlationId ?? "none");
          await indexFromEvent(indexer, event);
        },
        clientId: "trace-continuity",
      });

      assert.deepEqual(seen, [traceId], "the trace did not survive the broker");
    });
  });
});
