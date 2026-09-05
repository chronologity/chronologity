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
import { buildApp } from "../server/app.js";
import { testAppConfig } from "../testing/app-config.js";
import { createPerson, removePeople, type Person } from "../testing/moment-fixtures.js";

/**
 * How often one reader may ask.
 *
 * The application here is built with a real ceiling, which no other suite does —
 * the pattern ADR-119 established after adding a limit to `apps/api` "broke the
 * test suite before it protected anything, and the symptom was `results` being
 * undefined rather than anything mentioning limits".
 *
 * **The assertion that matters is the second reader.** That a limiter refuses
 * somebody who asks too often is a property of the library; that it refuses the
 * right *somebody* is a property of this configuration, and getting it wrong is
 * invisible until a household, an office or a school shares one budget between
 * them. Two readers over one connection is the only arrangement that can tell
 * the two apart, and `app.inject()` gives every request the same address.
 */

const config = testAppConfig();
const LIMIT = 3;

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;
const people: Person[] = [];

/**
 * Somebody signed in, with a token.
 *
 * @returns The person and a credential for them.
 */
async function reader(): Promise<Person & { token: string }> {
  const created = await createPerson(directory.pool);
  const sessionId = randomUUID();

  people.push(created);

  await directory.pool.query(
    `INSERT INTO sessions (session_id, identity_id, created_at, expires_at, revoked_at)
     VALUES ($1, $2, now(), now() + interval '1 hour', NULL)`,
    [sessionId, created.identityId],
  );

  return {
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
}

/**
 * Ask once.
 *
 * @param token - Whose credential, or undefined for an anonymous request.
 * @returns The HTTP status.
 */
async function ask(token?: string): Promise<number> {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    payload: { query: "{ viewer { authenticated } }" },
  });

  return response.statusCode;
}

beforeAll(async () => {
  store = createReadStore(config.clickhouse);
  directory = createDirectory(config.database);

  app = await buildApp({
    config,
    dependencies: [store, directory],
    rateLimits: { perWindow: LIMIT, windowMinutes: 1 },
    graphql: {
      store,
      sessions: new SessionRepository(directory.pool),
      eligibility: new TimelineEligibilityResolver(asQueryable(directory.pool)),
      directory: directory.pool,
    },
  });
});

afterAll(async () => {
  await removePeople(directory.pool, people);
  await app.close();
  await store.close();
  await directory.close();
});

describe("asking too often", () => {
  it("refuses a reader past their ceiling, and says to come back", async () => {
    const who = await reader();

    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      assert.equal(await ask(who.token), 200, `request ${attempt} was refused too early`);
    }

    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      headers: { authorization: `Bearer ${who.token}` },
      payload: { query: "{ viewer { authenticated } }" },
    });

    assert.equal(response.statusCode, 429);
    assert.ok(response.headers["retry-after"] !== undefined, "no retry-after to back off by");
  });

  it("says nothing about how much room is left", async () => {
    // A countdown tells somebody exactly how hard they may push. `retry-after`
    // is kept because backing off correctly needs it; the remaining count is
    // not, for the reason `apps/api` withholds it too.
    const who = await reader();

    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      headers: { authorization: `Bearer ${who.token}` },
      payload: { query: "{ viewer { authenticated } }" },
    });

    assert.equal(response.headers["x-ratelimit-remaining"], undefined);
  });

  it("does not spend one reader's budget on another", async () => {
    // The assertion this suite exists for. Both readers arrive over the same
    // connection, so a limiter keyed on the address would refuse the second
    // before they had asked for anything.
    const first = await reader();
    const second = await reader();

    for (let attempt = 0; attempt <= LIMIT; attempt += 1) {
      await ask(first.token);
    }

    assert.equal(await ask(first.token), 429, "the first reader was not limited");
    assert.equal(await ask(second.token), 200, "the second reader paid for the first's requests");
  });

  it("counts an unfinished account by connection rather than not at all", async () => {
    // Somebody signed in who has not finished creating an account has no
    // account to key on. Falling back is what stops that state being a way to
    // ask without limit.
    for (let attempt = 0; attempt <= LIMIT * 2; attempt += 1) {
      await ask();
    }

    assert.equal(await ask(), 429);
  });
});
