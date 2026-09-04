import assert from "node:assert/strict";
import { testAppConfig } from "../../testing/app-config.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createRecordedPlaceSearchClient } from "../../integrations/places/recorded-place-search-client.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { LocationRepository } from "../locations/location.repository.js";
import { ModerationRepository } from "../moderation/moderation.repository.js";
import { LocationService } from "../locations/location.service.js";
import { RealWorldEventRepository } from "./real-world-event.repository.js";
import { RealWorldEventService } from "./real-world-event.service.js";

/**
 * Real-world Events, end to end against real infrastructure.
 *
 * Driven through HTTP because that is the whole surface: two endpoints, and
 * everything an Event is has to survive the round trip through them. The rules
 * that decide anything are pure and covered exhaustively next door; what this
 * proves is that they are actually reached, that the schema refuses what it
 * should before a handler runs, and that an occurrence read back is the one
 * that was recorded.
 *
 * The map service is answered from recorded responses, so that recording a
 * place to attach never calls OpenStreetMap.
 *
 * Requires `pnpm infra:up`.
 */

const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? "8025"}`;

const config = testAppConfig("real-world-events-integration");

const ADULT = "1990-04-12";
const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

describe("real-world event endpoints", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);

    const locationRepository = new LocationRepository(database.dataSource);

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, new UserRepository(database.dataSource), {
        minimumAgeYears: config.minimumAgeYears,
      }),
      locations: new LocationService(
        database.dataSource,
        locationRepository,
        createRecordedPlaceSearchClient(),
      ),
      realWorldEvents: new RealWorldEventService(
        database.dataSource,
        new RealWorldEventRepository(database.dataSource),
        locationRepository,
        new ModerationRepository(database.dataSource),
      ),
    });
  });

  afterAll(async () => {
    await app.close();
    await authentication.close();
    await database.close();
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

  const authed = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  /** Sign in for real, stopping before account creation. */
  const signIn = async () => {
    const email = uniqueEmail();
    await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
    const token = await readLinkFor(email);
    const response = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token },
    });

    assert.equal(response.statusCode, 201, response.body);

    return response.json();
  };

  /** Sign in and finish creating an account. */
  const onboard = async () => {
    const credentials = await signIn();
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(credentials.accessToken),
      payload: { handle: uniqueHandle(), displayName: "Test Person", dateOfBirth: ADULT },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { ...credentials, userId: created.json().userId as string };
  };

  /** A recorded place, so an Event has something real to point at. */
  const place = async (accessToken: string, name: string): Promise<string> => {
    const response = await app.inject({
      method: "POST",
      url: "/locations",
      headers: authed(accessToken),
      payload: {
        name,
        precision: "exact",
        coordinates: { latitude: 40.7505, longitude: -73.9934 },
      },
    });

    assert.equal(response.statusCode, 201, response.body);

    return response.json().locationId;
  };

  /**
   * A private Moment belonging to an Event.
   *
   * Written by SQL rather than through the API: recording a Moment needs an
   * upload and a caption, and none of that is what these assertions are about.
   *
   * @param authorUserId - Whose Moment it is.
   * @param realWorldEventId - Which Event it belongs to.
   * @returns Nothing.
   */
  const attachPrivateMoment = async (
    authorUserId: string,
    realWorldEventId: string,
  ): Promise<void> => {
    const momentId = randomUUID();

    await database.dataSource.query(
      `INSERT INTO moments (moment_id, author_user_id, caption, occurrence_start,
                            occurrence_end, occurrence_precision,
                            occurrence_offset_minutes, visibility)
       VALUES ($1, $2, 'a private afternoon', now(), now(), 'instant', 0, 'private')`,
      [momentId, authorUserId],
    );
    await database.dataSource.query(
      "INSERT INTO moment_real_world_events (moment_id, real_world_event_id) VALUES ($1, $2)",
      [momentId, realWorldEventId],
    );
  };

  /** A three-day convention, at day precision. */
  const convention = {
    start: "2026-11-20T00:00:00.000Z",
    end: "2026-11-22T23:59:59.000Z",
    precision: "day",
  } as const;

  const record = async (accessToken: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/real-world-events",
      headers: authed(accessToken),
      payload,
    });

  describe("recording an occurrence", () => {
    it("keeps the interval and the precision it was given", async () => {
      const credentials = await onboard();

      const response = await record(credentials.accessToken, {
        name: "Anime NYC 2026",
        occurrence: convention,
      });

      assert.equal(response.statusCode, 201, response.body);

      // The interval is what carries the approximation. A convention known to
      // the day must not come back claiming a clock time nobody recorded.
      assert.deepEqual(response.json().occurrence, convention);
      assert.equal(response.json().name, "Anime NYC 2026");
    });

    it("records who first entered it, without making them its owner", async () => {
      const credentials = await onboard();

      const response = await record(credentials.accessToken, {
        name: "A public ceremony",
        occurrence: convention,
      });

      // Provenance is recorded, and is the only claim made. Nothing anywhere
      // treats this identifier as authority over the occurrence — which is why
      // somebody else can record the same one, as the test above shows.
      assert.equal(response.json().createdByUserId, credentials.userId);
    });

    it("lets two people record the same occurrence separately", async () => {
      const first = await onboard();
      const second = await onboard();
      const name = `Anime NYC ${randomUUID()}`;

      const one = await record(first.accessToken, { name, occurrence: convention });
      const two = await record(second.accessToken, { name, occurrence: convention });

      assert.equal(one.statusCode, 201, one.body);
      assert.equal(two.statusCode, 201, two.body);

      // Duplicates are expected before reconciliation exists. Refusing the
      // second would refuse real history to protect a guess, and identity is
      // the identifier rather than the name.
      assert.notEqual(one.json().realWorldEventId, two.json().realWorldEventId);
    });

    it("keeps the other names it goes by", async () => {
      const credentials = await onboard();

      const response = await record(credentials.accessToken, {
        name: "Anime NYC 2026",
        aliases: ["ANYC", "Anime New York"],
        occurrence: convention,
      });

      assert.deepEqual(response.json().aliases, ["ANYC", "Anime New York"].sort());
    });

    it("does not store a name a second time as an alias", async () => {
      const credentials = await onboard();

      const response = await record(credentials.accessToken, {
        name: "Anime NYC 2026",
        aliases: ["Anime NYC 2026", "ANYC"],
        occurrence: convention,
      });

      assert.deepEqual(response.json().aliases, ["ANYC"]);
    });

    it("keeps every place it happened, not one", async () => {
      const credentials = await onboard();
      const newYork = await place(credentials.accessToken, `New York ${randomUUID()}`);
      const london = await place(credentials.accessToken, `London ${randomUUID()}`);
      const tokyo = await place(credentials.accessToken, `Tokyo ${randomUUID()}`);

      const response = await record(credentials.accessToken, {
        name: "A launch in three cities at once",
        occurrence: convention,
        locationIds: [newYork, london, tokyo],
      });

      assert.equal(response.statusCode, 201, response.body);
      assert.deepEqual(response.json().locationIds, [newYork, london, tokyo].sort());
    });

    it("records an instant as a point in time", async () => {
      const credentials = await onboard();
      const moment = "2026-11-20T09:00:00.000Z";

      const response = await record(credentials.accessToken, {
        name: "The moment the doors opened",
        occurrence: { start: moment, end: moment, precision: "instant" },
      });

      assert.equal(response.statusCode, 201, response.body);
      assert.deepEqual(response.json().occurrence, {
        start: moment,
        end: moment,
        precision: "instant",
      });
    });

    it("records a year nobody knows the day of", async () => {
      const credentials = await onboard();
      const year = {
        start: "1969-01-01T00:00:00.000Z",
        end: "1969-12-31T23:59:59.000Z",
        precision: "year",
      };

      const response = await record(credentials.accessToken, {
        name: "Sometime in 1969",
        occurrence: year,
      });

      assert.equal(response.statusCode, 201, response.body);
      assert.deepEqual(response.json().occurrence, year);
    });
  });

  describe("refusing what cannot be true", () => {
    it("refuses an occurrence that ends before it starts", async () => {
      const credentials = await onboard();

      const response = await record(credentials.accessToken, {
        name: "Backwards",
        occurrence: {
          start: "2026-11-22T00:00:00.000Z",
          end: "2026-11-20T00:00:00.000Z",
          precision: "day",
        },
      });

      // Refused by the contract before a handler runs: `occurrenceSchema`
      // carries the same rule the policy does.
      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses an instant that spans two moments", async () => {
      const credentials = await onboard();

      const response = await record(credentials.accessToken, {
        name: "Not really an instant",
        occurrence: {
          start: "2026-11-20T09:00:00.000Z",
          end: "2026-11-20T11:00:00.000Z",
          precision: "instant",
        },
      });

      // The schema permits this shape, so it is the service's own guard and
      // only reachable from here.
      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses a place that does not exist rather than dropping it", async () => {
      const credentials = await onboard();

      const response = await record(credentials.accessToken, {
        name: "Somewhere that is not recorded",
        occurrence: convention,
        locationIds: [randomUUID()],
      });

      // Silently discarding it would record an Event claiming fewer places
      // than the person said it had.
      assert.equal(response.statusCode, 400, response.body);
    });

    it("refuses a nameless occurrence", async () => {
      const credentials = await onboard();

      const response = await record(credentials.accessToken, {
        name: "   ",
        occurrence: convention,
      });

      assert.equal(response.statusCode, 400, response.body);
    });
  });

  describe("reading one back", () => {
    it("returns it whole", async () => {
      const credentials = await onboard();
      const venue = await place(credentials.accessToken, `Javits ${randomUUID()}`);

      const created = await record(credentials.accessToken, {
        name: "Anime NYC 2026",
        aliases: ["ANYC"],
        occurrence: convention,
        locationIds: [venue],
      });

      const response = await app.inject({
        method: "GET",
        url: `/real-world-events/${created.json().realWorldEventId}`,
        headers: authed(credentials.accessToken),
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), created.json());
    });

    it("refuses one whose only history the caller may not read", async () => {
      // Visibility is derived: an Event is as private as the history that
      // establishes it. A stranger who cannot read the Moment cannot know the
      // occasion happened.
      const author = await onboard();
      const stranger = await onboard();
      const created = await record(author.accessToken, {
        name: `Private gathering ${randomUUID()}`,
        occurrence: convention,
      });
      const realWorldEventId = created.json().realWorldEventId as string;

      await attachPrivateMoment(author.userId, realWorldEventId);

      const response = await app.inject({
        method: "GET",
        url: `/real-world-events/${realWorldEventId}`,
        headers: authed(stranger.accessToken),
      });

      assert.equal(response.statusCode, 404, response.body);
    });

    it("returns it to whoever recorded that history", async () => {
      const author = await onboard();
      const created = await record(author.accessToken, {
        name: `Private gathering ${randomUUID()}`,
        occurrence: convention,
      });
      const realWorldEventId = created.json().realWorldEventId as string;

      await attachPrivateMoment(author.userId, realWorldEventId);

      const response = await app.inject({
        method: "GET",
        url: `/real-world-events/${realWorldEventId}`,
        headers: authed(author.accessToken),
      });

      assert.equal(response.statusCode, 200, response.body);
    });

    it("refuses an Event no Moment points at, to anybody but its creator", async () => {
      // The assertion that pins the creator exemption. Without it, "the creator
      // may read what they recorded" quietly degrades into "any authenticated
      // caller may read anything" the moment somebody simplifies the rule — and
      // the test above would still pass.
      const creator = await onboard();
      const stranger = await onboard();
      const created = await record(creator.accessToken, {
        name: `Unattached ${randomUUID()}`,
        occurrence: convention,
      });

      const response = await app.inject({
        method: "GET",
        url: `/real-world-events/${created.json().realWorldEventId}`,
        headers: authed(stranger.accessToken),
      });

      assert.equal(response.statusCode, 404, response.body);
    });

    it("returns 404 for one that does not exist", async () => {
      const credentials = await onboard();

      const response = await app.inject({
        method: "GET",
        url: `/real-world-events/${randomUUID()}`,
        headers: authed(credentials.accessToken),
      });

      assert.equal(response.statusCode, 404, response.body);
    });
  });

  describe("who may call these at all", () => {
    it("refuses recording without a caller", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/real-world-events",
        payload: { name: "Anime NYC 2026", occurrence: convention },
      });

      assert.equal(response.statusCode, 401, response.body);
    });

    it("refuses reading without a caller", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/real-world-events/${randomUUID()}`,
      });

      assert.equal(response.statusCode, 401, response.body);
    });
  });
});
