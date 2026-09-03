import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, it } from "vitest";
import { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import { SessionRepository } from "../auth/session.repository.js";
import type { AppConfig } from "../config/app-config.js";
import { createReadStore, type ReadStore } from "../read-models/clickhouse/client.js";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { asQueryable } from "../read-models/postgres/queryable.js";
import { testAppConfig } from "../testing/app-config.js";
import { buildApp } from "./app.js";

/**
 * The aggregator against the stores it actually reads.
 *
 * What the unit suites cannot prove: that this application's ClickHouse client
 * reaches the projection the API writes, that its PostgreSQL query matches the
 * columns the API's migrations created, and that revoking a Session in the
 * database refuses the next read rather than the read after the token expires.
 *
 * Every one of those is a question about agreement between two applications
 * that may not import each other, which is exactly the kind of agreement a unit
 * test cannot hold up.
 *
 * It arranges its own state by SQL — an Identity and a Session — because the
 * fixtures that would otherwise build them live in `apps/api`. That is the one
 * place this suite sets the service's read-only posture aside, and it does so
 * as a test running under the developer's role, never as application code.
 */

const config: AppConfig = testAppConfig();

const IDENTITY = randomUUID();
const OPEN_SESSION = randomUUID();
const REVOKED_SESSION = randomUUID();
const EXPIRED_SESSION = randomUUID();
const USER = randomUUID();

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;

const tokenFor = async (sessionId: string): Promise<string> =>
  new SignJWT({ sid: sessionId, uid: USER })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(IDENTITY)
    .setIssuer(config.auth.issuer)
    .setAudience(config.auth.audience)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(config.auth.jwtSecret);

const ask = async (query: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: "/graphql", headers, payload: { query } });

beforeAll(async () => {
  store = createReadStore(config.clickhouse);
  directory = createDirectory(config.database);

  // Named rather than left to fail as a missing relation halfway through. The
  // schema belongs to the API, and the remedy is to run its migrations.
  const present = await directory.pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.sessions') IS NOT NULL AS exists",
  );

  if (present.rows[0]?.exists !== true) {
    throw new Error(
      "The `sessions` table is missing. The API owns this schema: run " +
        "`pnpm --filter @chronologity/api migrate` and try again.",
    );
  }

  await directory.pool.query(
    "INSERT INTO identities (identity_id, created_at) VALUES ($1, now())",
    [IDENTITY],
  );

  await directory.pool.query(
    `INSERT INTO sessions (session_id, identity_id, created_at, expires_at, revoked_at)
     VALUES ($1, $4, now(), now() + interval '1 hour', NULL),
            ($2, $4, now(), now() + interval '1 hour', now()),
            ($3, $4, now() - interval '2 hours', now() - interval '1 hour', NULL)`,
    [OPEN_SESSION, REVOKED_SESSION, EXPIRED_SESSION, IDENTITY],
  );

  app = await buildApp({
    config,
    dependencies: [store, directory],
    graphql: {
      store,
      sessions: new SessionRepository(directory.pool),
      eligibility: new TimelineEligibilityResolver(asQueryable(directory.pool)),
      directory: directory.pool,
    },
  });
});

afterAll(async () => {
  await directory.pool.query("DELETE FROM sessions WHERE identity_id = $1", [IDENTITY]);
  await directory.pool.query("DELETE FROM identities WHERE identity_id = $1", [IDENTITY]);

  await app.close();
  await store.close();
  await directory.close();
});

describe("the stores this instance reads through", () => {
  it("reports ready once both answer a real query", async () => {
    const response = await app.inject({ method: "GET", url: "/health/ready" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: "ready",
      dependencies: [
        { name: "clickhouse", healthy: true },
        { name: "postgres", healthy: true },
      ],
    });
  });

  it("can read the Timeline projection the API writes", async () => {
    // The agreement that matters between the two applications: this client, on
    // these credentials, against the table the API's ClickHouse migrations
    // created, naming the projection version this process is configured for.
    const result = await store.client.query({
      query: `SELECT count() AS total FROM timeline_moments
               WHERE projection_version = {version:String}`,
      query_params: { version: store.projectionVersion },
      format: "JSONEachRow",
    });

    const rows = await result.json<{ total: string }>();

    assert.equal(rows.length, 1);
    assert.ok(Number(rows[0]?.total) >= 0);
  });
});

describe("who the request is from", () => {
  it("reads history anonymously when no credential is offered", async () => {
    const response = await ask("{ viewer { authenticated userId } }");

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data, { viewer: { authenticated: false, userId: null } });
  });

  it("authenticates a token whose Session is open in the database", async () => {
    const response = await ask("{ viewer { authenticated userId } }", {
      authorization: `Bearer ${await tokenFor(OPEN_SESSION)}`,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data, { viewer: { authenticated: true, userId: USER } });
  });

  it("refuses a token whose Session was revoked", async () => {
    // The reason this service reads PostgreSQL at all. The token is valid and
    // unexpired; signing out has to stop the next read, not the one after the
    // token lapses.
    const response = await ask("{ viewer { authenticated } }", {
      authorization: `Bearer ${await tokenFor(REVOKED_SESSION)}`,
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().errors[0].extensions.code, "AUTHENTICATION_FAILED");
  });

  it("refuses a token whose Session has expired", async () => {
    const response = await ask("{ viewer { authenticated } }", {
      authorization: `Bearer ${await tokenFor(EXPIRED_SESSION)}`,
    });

    assert.equal(response.statusCode, 401);
  });

  it("refuses a token naming a Session that was never created", async () => {
    const response = await ask("{ viewer { authenticated } }", {
      authorization: `Bearer ${await tokenFor(randomUUID())}`,
    });

    assert.equal(response.statusCode, 401);
  });

  it("refuses all three identically", async () => {
    // A caller learns that they are not authenticated and nothing about which
    // check refused them.
    const [revoked, expired, absent] = await Promise.all([
      ask("{ viewer { authenticated } }", {
        authorization: `Bearer ${await tokenFor(REVOKED_SESSION)}`,
      }),
      ask("{ viewer { authenticated } }", {
        authorization: `Bearer ${await tokenFor(EXPIRED_SESSION)}`,
      }),
      ask("{ viewer { authenticated } }", {
        authorization: `Bearer ${await tokenFor(randomUUID())}`,
      }),
    ]);

    const message = (response: { json: () => { errors: { message: string }[] } }) =>
      response.json().errors[0]?.message;

    assert.equal(message(revoked), message(expired));
    assert.equal(message(expired), message(absent));
  });
});
