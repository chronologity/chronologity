import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, it } from "vitest";
import { SessionRepository } from "../../auth/session.repository.js";
import type { AppConfig } from "../../config/app-config.js";
import { createReadStore, type ReadStore } from "../../read-models/clickhouse/client.js";
import { createDirectory, type Directory } from "../../read-models/postgres/client.js";
import { asQueryable } from "../../read-models/postgres/queryable.js";
import { buildApp } from "../../server/app.js";
import { testAppConfig } from "../../testing/app-config.js";
import { countingPool, countingStore, newCost } from "../../testing/counting.js";
import { createPerson, removePeople, type Person } from "../../testing/moment-fixtures.js";
import { TOO_EXPENSIVE } from "./cost-rule.js";

/**
 * Turning a document away before it costs anything.
 *
 * The unit tests settle what a document costs. What is settled here is the
 * property that makes the bound worth having: **a refused document spends
 * nothing.** A limiter that counted as resolvers ran would refuse a request
 * having already paid for the part it executed, and the statement counters are
 * the only thing that can tell those two apart.
 *
 * The application is built with a real ceiling rather than the generous one
 * every other suite uses — the pattern ADR-119 established for `apps/api` after
 * a rate limit "broke the test suite before it protected anything".
 */

const base = testAppConfig();
const config: AppConfig = {
  ...base,
  graphql: { ...base.graphql, maxCost: 5 },
};

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;
let reader: Person & { token: string };
const people: Person[] = [];
const cost = newCost();

/** A document opening `count` Moments and asking each for everything. */
const opening = (count: number): string =>
  `query Open {\n${Array.from(
    { length: count },
    (_unused, index) =>
      `  m${index}: moment(id: "${randomUUID()}") {
         media(first: 5) { edges { node { mediaId } } }
         comments(first: 5) { total edges { node { commentId } } }
         reactions { total }
         relationships { relationshipId }
       }`,
  ).join("\n")}\n}`;

/**
 * Ask, and report what it cost.
 *
 * @param query - The document.
 * @returns The statements issued and the body.
 */
async function ask(query: string): Promise<{
  postgres: number;
  clickhouse: number;
  body: { data: unknown; errors?: { message: string; extensions?: { code?: string } }[] };
}> {
  cost.postgres = 0;
  cost.clickhouse = 0;

  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${reader.token}` },
    payload: { query },
  });

  return { postgres: cost.postgres, clickhouse: cost.clickhouse, body: response.json() };
}

beforeAll(async () => {
  store = createReadStore(config.clickhouse);
  directory = createDirectory(config.database);

  app = await buildApp({
    config,
    dependencies: [store, directory],
    graphql: {
      store: countingStore(store, cost),
      sessions: new SessionRepository(countingPool(directory.pool, cost)),
      eligibility: new TimelineEligibilityResolver(asQueryable(countingPool(directory.pool, cost))),
      directory: countingPool(directory.pool, cost),
    },
  });

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
  await app.close();
  await store.close();
  await directory.close();
});

describe("a document that asks for too much", () => {
  it("is refused having spent nothing beyond finding out who was asking", async () => {
    // The assertion the whole bound rests on. Not "it was refused" — a
    // resolver-time limiter would satisfy that too, having already paid for the
    // part it ran — but that the refusal cost what refusing costs.
    //
    // Stated against a document that asks for nothing rather than against zero,
    // because authentication is not part of what the document costs: the Session
    // is read in a hook, before the document has even been parsed. Comparing the
    // two is what separates "spent nothing" from "spent nothing except the one
    // thing every request spends".
    const floor = await ask("{ viewer { userId } }");
    const refused = await ask(opening(20));

    assert.equal(
      refused.postgres,
      floor.postgres,
      `a refused document cost ${refused.postgres} statements where asking for nothing costs ${floor.postgres}`,
    );
    assert.equal(refused.clickhouse, 0, `${refused.clickhouse} ClickHouse reads ran for a refused document`);
    assert.ok(
      refused.body.errors?.[0]?.message.startsWith(TOO_EXPENSIVE),
      JSON.stringify(refused.body.errors),
    );
  });

  it("is refused as a client error rather than as a failure", async () => {
    // It describes the document the client sent. `INTERNAL_ERROR` would tell a
    // client to retry something that will never succeed.
    const { body } = await ask(opening(20));

    assert.equal(body.errors?.[0]?.extensions?.code, "VALIDATION_FAILED");
  });

  it("does not refuse a document within the ceiling", async () => {
    // The other half, and the one that fails if a weight is wrong: an ordinary
    // request must still be answered. One batched Moment read plus media is two.
    const { body } = await ask(
      `{ m: moment(id: "${randomUUID()}") { media(first: 5) { edges { node { mediaId } } } } }`,
    );

    assert.equal(body.errors, undefined, JSON.stringify(body.errors));
  });

  it("still counts a Timeline page as one, however many entries it returns", async () => {
    // Page size is bounded elsewhere and costs one read whatever it is. A cost
    // model that charged per entry would refuse a legitimate page of two hundred.
    const { body } = await ask(
      `{ timeline(view: {scope: {type: PERSON, id: "${reader.userId}"}}, first: 200) { edges { cursor } } }`,
    );

    assert.equal(body.errors, undefined, JSON.stringify(body.errors));
  });
});
