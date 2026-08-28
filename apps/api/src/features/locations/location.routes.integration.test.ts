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
import { LocationRepository } from "./location.repository.js";
import { LocationService } from "./location.service.js";

/**
 * The Location endpoints, end to end against real infrastructure.
 *
 * The suite next door drives the service directly, which is where the rules and
 * the races are proven. This one exists for what only the HTTP surface decides:
 * who is allowed to call these at all, what the schemas refuse before a handler
 * runs, and which status code each answer becomes.
 *
 * The map service is answered from recorded responses. The public one is run by
 * volunteers who ask for at most one request a second, which a test suite would
 * blow through without noticing.
 *
 * Requires `pnpm infra:up`.
 */

const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? "8025"}`;

const config = testAppConfig("locations-integration");

const ADULT = "1990-04-12";
const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

describe("location endpoints", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, new UserRepository(database.dataSource), {
        minimumAgeYears: config.minimumAgeYears,
      }),
      locations: new LocationService(
        database.dataSource,
        new LocationRepository(database.dataSource),
        createRecordedPlaceSearchClient(),
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

    return credentials;
  };

  describe("searching for a place", () => {
    it("returns candidates and the attribution they must be shown with", async () => {
      const credentials = await onboard();

      const response = await app.inject({
        method: "GET",
        url: "/places/search?query=Madison%20Square%20Garden",
        headers: authed(credentials.accessToken),
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.ok(response.json().suggestions.length > 0);
      // ODbL requires crediting contributors wherever the data appears, so the
      // attribution is not an optional extra the client may drop.
      assert.match(response.json().attribution, /OpenStreetMap/);
    });

    it("bounds how many candidates one request may ask for", async () => {
      const credentials = await onboard();

      const response = await app.inject({
        method: "GET",
        url: "/places/search?query=Reykjavik&limit=500",
        headers: authed(credentials.accessToken),
      });

      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().code, "VALIDATION_FAILED");
    });

    it("refuses a search with nothing to search for", async () => {
      const credentials = await onboard();

      const response = await app.inject({
        method: "GET",
        url: "/places/search",
        headers: authed(credentials.accessToken),
      });

      assert.equal(response.statusCode, 400, response.body);
    });

    it("creates nothing", async () => {
      const credentials = await onboard();
      const before = await placeCount();

      await app.inject({
        method: "GET",
        url: "/places/search?query=Reykjavik",
        headers: authed(credentials.accessToken),
      });

      // A search returns candidates. A place exists only once somebody chooses.
      assert.equal(await placeCount(), before);
    });
  });

  describe("recording a place", () => {
    it("records one and answers with where it now lives", async () => {
      const credentials = await onboard();

      const response = await app.inject({
        method: "POST",
        url: "/locations",
        headers: authed(credentials.accessToken),
        payload: {
          name: "Nana's house",
          coordinates: { latitude: 53.4, longitude: -2.9 },
          precision: "exact",
        },
      });

      assert.equal(response.statusCode, 201, response.body);
      assert.match(response.json().locationId, /^[0-9a-f-]{36}$/);
      assert.equal(response.json().name, "Nana's house");
    });

    it("refuses a position the rules refuse, as a request problem", async () => {
      const credentials = await onboard();

      const response = await app.inject({
        method: "POST",
        url: "/locations",
        headers: authed(credentials.accessToken),
        payload: { name: "Somewhere", precision: "exact" },
      });

      // A refusal by the rules must reach the client as a 400, not a 500.
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().code, "VALIDATION_FAILED");
    });

    it("refuses a body the schema will not accept", async () => {
      const credentials = await onboard();

      const response = await app.inject({
        method: "POST",
        url: "/locations",
        headers: authed(credentials.accessToken),
        payload: { name: "", precision: "somewhere-ish" },
      });

      assert.equal(response.statusCode, 400, response.body);
    });
  });

  describe("reading a place", () => {
    it("reads one back", async () => {
      const credentials = await onboard();
      const recorded = await app.inject({
        method: "POST",
        url: "/locations",
        headers: authed(credentials.accessToken),
        payload: {
          name: "Somewhere Readable",
          coordinates: { latitude: 1, longitude: 2 },
          precision: "exact",
        },
      });

      const response = await app.inject({
        method: "GET",
        url: `/locations/${recorded.json().locationId}`,
        headers: authed(credentials.accessToken),
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().locationId, recorded.json().locationId);
    });

    it("answers 404 for a place that does not exist", async () => {
      const credentials = await onboard();

      const response = await app.inject({
        method: "GET",
        url: `/locations/${randomUUID()}`,
        headers: authed(credentials.accessToken),
      });

      assert.equal(response.statusCode, 404, response.body);
    });

    it("refuses an identifier that is not one", async () => {
      const credentials = await onboard();

      const response = await app.inject({
        method: "GET",
        url: "/locations/not-a-uuid",
        headers: authed(credentials.accessToken),
      });

      assert.equal(response.statusCode, 400, response.body);
    });
  });

  describe("who may call these at all", () => {
    it("refuses every endpoint without a token", async () => {
      const wellFormed = {
        name: "Somewhere",
        coordinates: { latitude: 1, longitude: 2 },
        precision: "exact",
      };

      for (const [method, url, payload] of [
        ["GET", "/places/search?query=Reykjavik", undefined],
        ["POST", "/locations", wellFormed],
        ["GET", `/locations/${randomUUID()}`, undefined],
      ] as const) {
        const response = await app.inject({ method, url, ...(payload && { payload }) });

        assert.equal(response.statusCode, 401, `${method} ${url} -> ${response.body}`);
      }
    });

    it("checks the body before checking who is asking", async () => {
      // Fastify validates against the schema during its own lifecycle, before
      // any preHandler runs, so a malformed body is refused as a bad request
      // whether or not the caller is signed in. Recorded because it means an
      // unauthenticated caller can learn the shape of a request — which is
      // acceptable here, since clients compile against the same published
      // schemas, but should be a decision rather than a surprise.
      const response = await app.inject({ method: "POST", url: "/locations", payload: {} });

      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().code, "VALIDATION_FAILED");
    });

    it("refuses someone who has authenticated but not finished creating an account", async () => {
      const credentials = await signIn();

      // Recording a place is attributed to a User, so an Identity alone is not
      // enough. The client is told to finish onboarding rather than to sign in
      // again, which it cannot distinguish from a plain 401.
      const response = await app.inject({
        method: "POST",
        url: "/locations",
        headers: authed(credentials.accessToken),
        payload: {
          name: "Too Early",
          coordinates: { latitude: 1, longitude: 2 },
          precision: "exact",
        },
      });

      assert.equal(response.statusCode, 403, response.body);
      assert.equal(response.json().code, "ONBOARDING_REQUIRED");
    });
  });

  /** How many places exist, for asserting that a search created none. */
  async function placeCount(): Promise<number> {
    const rows: { count: string }[] = await database.dataSource.query(`SELECT count(*) FROM locations`);

    return Number(rows[0]?.count ?? "0");
  }
});
