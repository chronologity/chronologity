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
import { createMoment, createPerson, removePeople, type Person } from "../testing/moment-fixtures.js";

/**
 * That one reader's answers never become another's.
 *
 * A test asserting that two requests hold different loader objects would prove
 * nothing about consequence. These three assert consequence, and each fails for
 * a **different** wrong implementation — which is the point, because the second
 * and third are exactly the shapes somebody reaches for after fixing the first.
 *
 * The loaders are built inside the closure that receives a request, where the
 * Viewer exists; the outer body where the read models are built has no Viewer to
 * construct one from, so hoisting them would not compile. These prove the
 * property that structural control exists to protect.
 */

const config = testAppConfig();

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;
let author: Person & { token: string };
let stranger: Person & { token: string };

const people: Person[] = [];

const MOMENT = `query Read($id: ID!) {
  moment(id: $id) {
    momentId
    personalSignificance { significant markedAt }
  }
}`;

/**
 * Somebody with a Session they can read through.
 *
 * @returns The person and their credential.
 */
async function signedInPerson(): Promise<Person & { token: string }> {
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

interface Answer {
  data: { moment: { momentId: string; personalSignificance: { markedAt: string | null } } | null };
  errors?: { message: string }[];
}

/**
 * Read one Moment as somebody.
 *
 * @param momentId - Which Moment.
 * @param token - Whose credential.
 * @returns The parsed answer.
 */
async function read(momentId: string, token: string): Promise<Answer> {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${token}` },
    payload: { query: MOMENT, variables: { id: momentId } },
  });

  return response.json() as Answer;
}

beforeAll(async () => {
  store = createReadStore(config.clickhouse);
  directory = createDirectory(config.database);

  const present = await directory.pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.moments') IS NOT NULL AS exists",
  );

  if (present.rows[0]?.exists !== true) {
    throw new Error("The schema is missing. The API owns it: run `pnpm db:migrate` and try again.");
  }

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

  author = await signedInPerson();
  stranger = await signedInPerson();
});

afterAll(async () => {
  await removePeople(directory.pool, people);
  await app.close();
  await store.close();
  await directory.close();
});

describe("one reader's answers are never another's", () => {
  it("does not hand a private Moment to whoever lost the race for it", async () => {
    // Concurrent rather than sequential, because promise-caching is the
    // mechanism and concurrency is the shape that actually occurs. A loader
    // shared across requests and keyed on identifier alone would give one of
    // these the other's answer, and which one would depend on timing.
    const hidden = await createMoment(directory.pool, author.userId, { visibility: "private" });
    const [mine, theirs] = await Promise.all([
      read(hidden, author.token),
      read(hidden, stranger.token),
    ]);

    assert.equal(mine.data.moment?.momentId, hidden);
    assert.equal(theirs.data.moment, null);
  });

  it("does not leak a private mark between two readers who may both read it", async () => {
    // The sharpest of the three, and the one the first would not catch. Both
    // readers are permitted, so no access decision disagrees anywhere — but the
    // reader's own significance mark is joined into the row by their identifier
    // and travels inside the answer. A shared loader leaks it silently.
    const shared = await createMoment(directory.pool, author.userId);

    await directory.pool.query(
      "INSERT INTO moment_personal_significance (moment_id, user_id, marked_at) VALUES ($1, $2, now())",
      [shared, author.userId],
    );

    const [mine, theirs] = await Promise.all([
      read(shared, author.token),
      read(shared, stranger.token),
    ]);

    assert.notEqual(mine.data.moment?.personalSignificance.markedAt, null);
    assert.equal(theirs.data.moment?.personalSignificance.markedAt, null);
  });

  it("forgets what it read as soon as the request is over", async () => {
    // This one fails for a loader that is correctly keyed by reader and
    // incorrectly kept for the life of the process — which is precisely the fix
    // somebody reaches for after the two above, and precisely what request
    // scoping forbids. Without it, cross-request caching could be smuggled in
    // here and the suite would stay green.
    const changing = await createMoment(directory.pool, author.userId);

    assert.equal((await read(changing, stranger.token)).data.moment?.momentId, changing);

    await directory.pool.query("UPDATE moments SET visibility = 'private' WHERE moment_id = $1", [
      changing,
    ]);

    assert.equal((await read(changing, stranger.token)).data.moment, null);
  });
});
