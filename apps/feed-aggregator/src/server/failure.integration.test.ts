import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, it } from "vitest";
import { SessionRepository } from "../auth/session.repository.js";
import { createReadStore, type ReadStore } from "../read-models/clickhouse/client.js";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { asQueryable } from "../read-models/postgres/queryable.js";
import { testAppConfig } from "../testing/app-config.js";
import { createPerson, removePeople, type Person } from "../testing/moment-fixtures.js";
import { buildApp } from "./app.js";

/**
 * What happens when a store cannot answer.
 *
 * **The failure this suite exists to prevent is silence.** A ClickHouse outage
 * used to reach a client as HTTP 200 carrying "An unexpected error occurred" —
 * and the dangerous shape is one step worse than that: a Timeline that returned
 * no entries because the read failed is, to a client, a Timeline with nothing in
 * it. Somebody's history appearing to have vanished is not a degraded answer, it
 * is a wrong one.
 *
 * `feed.md:1204` asks for "a controlled availability error" and `feed.md:1206`
 * forbids the tempting alternative: reading authoritative PostgreSQL instead.
 * There is no such fallback in the code, and the assertion below is what would
 * notice if somebody added one — an outage that produced a page would mean the
 * page came from somewhere it should not have.
 *
 * The outage is injected rather than caused: `observability.md:1749` says not to
 * introduce chaos testing before instrumentation exists, and a store that throws
 * is the smallest thing that proves the path.
 */

const config = testAppConfig();

let store: ReadStore;
let directory: Directory;
let reader: Person & { token: string };
const people: Person[] = [];

const TIMELINE = `query Timeline($view: TimelineViewInput!) {
  timeline(view: $view, first: 10) { edges { cursor } }
}`;

/**
 * An application whose ClickHouse reads fail the way an outage fails.
 *
 * @param code - What the socket layer would have reported.
 * @returns The application.
 */
async function withBrokenStore(code: string): Promise<FastifyInstance> {
  const failing = {
    ...store,
    client: {
      query: () => {
        const error = new Error("connect ECONNREFUSED 127.0.0.1:8123") as Error & { code: string };

        error.code = code;
        throw error;
      },
    },
  } as unknown as ReadStore;

  return buildApp({
    config,
    dependencies: [store, directory],
    graphql: {
      store: failing,
      sessions: new SessionRepository(directory.pool),
      eligibility: new TimelineEligibilityResolver(asQueryable(directory.pool)),
      directory: directory.pool,
    },
  });
}

/**
 * Read a Timeline through an application.
 *
 * @param app - The application.
 * @returns The status and body.
 */
async function readTimeline(app: FastifyInstance): Promise<{
  status: number;
  body: {
    data: { timeline?: { edges: unknown[] } | null } | null;
    errors?: { message: string; extensions?: { code?: string } }[];
  };
}> {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${reader.token}` },
    payload: {
      query: TIMELINE,
      variables: { view: { scope: { type: "PERSON", id: reader.userId } } },
    },
  });

  return { status: response.statusCode, body: response.json() };
}

beforeAll(async () => {
  store = createReadStore(config.clickhouse);
  directory = createDirectory(config.database);

  const created = await createPerson(directory.pool);
  const sessionId = randomUUID();

  people.push(created);

  await directory.pool.query(
    `INSERT INTO sessions (session_id, identity_id, created_at, expires_at, revoked_at)
     VALUES ($1, $2, now(), now() + interval '1 hour', NULL)`,
    [sessionId, created.identityId],
  );

  reader = {
    ...created,
    token: await new SignJWT({ sid: sessionId, uid: created.userId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(created.identityId)
      .setIssuer(config.auth.issuer)
      .setAudience(config.auth.audience)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(config.auth.jwtSecret),
  };
});

afterAll(async () => {
  await removePeople(directory.pool, people);
  await store.close();
  await directory.close();
});

describe("a store that cannot answer", () => {
  it("never presents an outage as a Timeline with nothing in it", async () => {
    // The assertion this suite exists for. An empty page and a failed read are
    // the same bytes to a client unless the failure is said out loud.
    const app = await withBrokenStore("ECONNREFUSED");

    try {
      const { body } = await readTimeline(app);

      assert.notDeepEqual(
        body.data?.timeline,
        { edges: [] },
        "an outage was presented as an empty Timeline",
      );
      assert.ok(body.errors !== undefined, "an outage produced no error at all");
    } finally {
      await app.close();
    }
  });

  it("says the history is unavailable, and that trying again may work", async () => {
    const app = await withBrokenStore("ECONNREFUSED");

    try {
      const { body } = await readTimeline(app);

      assert.equal(body.errors?.[0]?.extensions?.code, "PROVIDER_UNAVAILABLE");
    } finally {
      await app.close();
    }
  });

  it("answers 503, so what sits in front can tell an outage from a defect", async () => {
    // A load balancer takes an instance out of rotation for one and pages
    // somebody for the other. Both used to answer 200.
    const app = await withBrokenStore("ECONNREFUSED");

    try {
      const { status } = await readTimeline(app);

      assert.equal(status, 503);
    } finally {
      await app.close();
    }
  });

  it("treats a query stopped by its own budget the same way", async () => {
    // A read cancelled for running too long is an availability answer, not a
    // defect: the same request may well succeed when the server is less busy.
    const app = await withBrokenStore("TIMEOUT_EXCEEDED");

    try {
      const { status, body } = await readTimeline(app);

      assert.equal(status, 503);
      assert.equal(body.errors?.[0]?.extensions?.code, "PROVIDER_UNAVAILABLE");
    } finally {
      await app.close();
    }
  });

  it("still calls an unrecognised failure a defect", async () => {
    // The other half, and the one that keeps the classifier honest. A failure
    // nobody has classified must not be reported as "try again", because the
    // retry will fail forever and nobody will be paged.
    const app = await withBrokenStore("SOMETHING_NOBODY_HAS_SEEN");

    try {
      const { status, body } = await readTimeline(app);

      assert.equal(body.errors?.[0]?.extensions?.code, "INTERNAL_ERROR");
      assert.notEqual(status, 503);
    } finally {
      await app.close();
    }
  });

  it("says nothing about what failed", async () => {
    // The injected message carries an address and a port. A driver's message
    // can carry a fragment of the statement instead, and a statement carries
    // identifiers.
    const app = await withBrokenStore("ECONNREFUSED");

    try {
      const { body } = await readTimeline(app);

      assert.ok(!JSON.stringify(body).includes("8123"), "the client was told where the store is");
      assert.ok(!JSON.stringify(body).includes("ECONNREFUSED"));
    } finally {
      await app.close();
    }
  });
});
