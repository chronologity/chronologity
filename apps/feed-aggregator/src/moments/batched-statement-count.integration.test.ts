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
import { countingPool, countingStore, newCost } from "../testing/counting.js";
import {
  createComment,
  createMoment,
  createPerson,
  removePeople,
  type Person,
} from "../testing/moment-fixtures.js";

/**
 * What repetition costs.
 *
 * Nothing in this service reads per item — every list is one statement, and that
 * was true before any of this existed. What was never bounded is **repetition by
 * the client**: nothing stops a document naming the same kind of thing a hundred
 * times, and each naming was a statement.
 *
 * The discussion case is the one that mattered. Replies are read by naming their
 * thread rather than through a field on a comment, which was the right call — a
 * connection per comment would have been one query per row — but it moved the
 * multiplication from the server into the document, where nothing capped it.
 *
 * **These assert growth, not magnitude.** A number here is a machine on a day; a
 * number that does not move as the document grows is a claim about shape.
 */

const config = testAppConfig();

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;
let reader: Person & { token: string };
let momentId = "";
const threads: string[] = [];

const people: Person[] = [];
const cost = newCost();

/** A document naming one Moment's discussion `count` times, one thread each. */
const threadedDocument = (count: number): string => {
  const selections = threads
    .slice(0, count)
    .map(
      (thread, index) =>
        `r${index}: comments(first: 5, thread: "${thread}") { edges { node { commentId body } } }`,
    )
    .join("\n      ");

  return `query Threads($id: ID!) {
    moment(id: $id) {
      momentId
      ${selections}
    }
  }`;
};

/**
 * A document naming `count` Moments, reading only what the Moment read itself
 * returns.
 *
 * Deliberately no `media` or `reactions`: those are a statement each per Moment
 * and remain so. This phase batched the Moment read and the discussion read,
 * which is what measurement found worth batching; how many selections one
 * document may carry is a different question and belongs to admission control.
 */
const manyMoments = (ids: readonly string[]): string => {
  const selections = ids
    .map((id, index) => `m${index}: moment(id: "${id}") { momentId caption visibility }`)
    .join("\n    ");

  return `query Many {\n    ${selections}\n  }`;
};

/**
 * Ask, and report what it cost.
 *
 * @param query - The document.
 * @param variables - Its variables.
 * @returns The cost per store, and the body so a test can prove it answered.
 */
async function costOf(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ postgres: number; body: { data: unknown; errors?: { message: string }[] } }> {
  cost.postgres = 0;
  cost.clickhouse = 0;

  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${reader.token}` },
    payload: { query, variables },
  });

  return { postgres: cost.postgres, body: response.json() };
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

  momentId = await createMoment(directory.pool, reader.userId);

  // A hundred-comment discussion, each with a reply, which is the shape the
  // batching exists for.
  for (let index = 0; index < 100; index += 1) {
    const thread = await createComment(directory.pool, momentId, reader.userId, {
      body: `top ${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    });

    threads.push(thread);
    await createComment(directory.pool, momentId, reader.userId, {
      body: `reply ${index}`,
      threadCommentId: thread,
      createdAt: new Date(Date.UTC(2026, 1, 1, 0, 0, index)).toISOString(),
    });
  }

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
});

afterAll(async () => {
  await removePeople(directory.pool, people);
  await app.close();
  await store.close();
  await directory.close();
});

describe("reading a hundred threads of one discussion", () => {
  it("costs the same as reading two", async () => {
    // The assertion this file exists for. Each of these was a statement; they
    // are now one, and the number stops moving with the document.
    const two = await costOf(threadedDocument(2), { id: momentId });
    const hundred = await costOf(threadedDocument(100), { id: momentId });

    assert.equal(two.body.errors, undefined, JSON.stringify(two.body.errors));
    assert.equal(hundred.body.errors, undefined, JSON.stringify(hundred.body.errors));
    assert.equal(hundred.postgres, two.postgres);
  });

  it("actually returned the hundred discussions it was asked for", async () => {
    // Without this, the number above could be the cost of refusing.
    const { body } = await costOf(threadedDocument(100), { id: momentId });
    const moment = (body.data as { moment: Record<string, { edges: unknown[] }> }).moment;
    const answered = Object.keys(moment).filter((field) => field.startsWith("r"));

    assert.equal(answered.length, 100);
    assert.equal(moment.r0?.edges.length, 1);
    assert.equal(moment.r99?.edges.length, 1);
  });

  it("stays within a handful of statements for the whole hundred", async () => {
    // Magnitude, which is a judgement and generously bounded: the Session, the
    // Viewer's age, the Moment, and one statement for the replies.
    const { postgres } = await costOf(threadedDocument(100), { id: momentId });

    assert.ok(postgres <= 6, `a hundred threads cost ${postgres} statements`);
  });
});

describe("reading many Moments at once", () => {
  it("costs the same for ten as for one", async () => {
    const ids: string[] = [];

    for (let index = 0; index < 10; index += 1) {
      ids.push(await createMoment(directory.pool, reader.userId));
    }

    const one = await costOf(manyMoments(ids.slice(0, 1)));
    const ten = await costOf(manyMoments(ids));

    assert.equal(one.body.errors, undefined, JSON.stringify(one.body.errors));
    assert.equal(ten.body.errors, undefined, JSON.stringify(ten.body.errors));
    assert.equal(ten.postgres, one.postgres);
  });

  it("reads one Moment once, however often a document names it", async () => {
    // The correctness half, and the reason this loader exists at all. Two
    // selections that asked separately could be answered differently — one
    // saying the Moment may be read and the other that it may not — inside a
    // single response.
    const twice = await costOf(manyMoments([momentId, momentId]));
    const once = await costOf(manyMoments([momentId]));

    assert.equal(twice.postgres, once.postgres);
  });

  it("still pays per Moment for the fields that hang off one", async () => {
    // Recorded rather than hidden. Batching the Moment read does not batch the
    // reads beneath it, and nothing has measured those as a problem: a document
    // asking ten Moments for their media is ten statements, and what bounds that
    // is a limit on how much one document may ask for rather than a loader.
    const ids = [momentId, await createMoment(directory.pool, reader.userId)];
    const withMedia = (chosen: readonly string[]) =>
      `query Media {\n    ${chosen
        .map(
          (id, index) =>
            `m${index}: moment(id: "${id}") { media(first: 5) { edges { node { mediaId } } } }`,
        )
        .join("\n    ")}\n  }`;

    const one = await costOf(withMedia(ids.slice(0, 1)));
    const two = await costOf(withMedia(ids));

    assert.equal(two.postgres, one.postgres + 1);
  });
});
