import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";
import { SessionRepository } from "../auth/session.repository.js";
import { createReadStore, type ReadStore } from "../read-models/clickhouse/client.js";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { asQueryable } from "../read-models/postgres/queryable.js";
import { buildApp } from "../server/app.js";
import { testAppConfig } from "../testing/app-config.js";
import {
  attachMedia,
  createComment,
  createMoment,
  createPerson,
  removePeople,
  type Person,
} from "../testing/moment-fixtures.js";

/**
 * What one Moment costs, and what it must go on costing.
 *
 * `testing.md:639` asks for it and `feed.md:670` says why: "a resolver that
 * performs one remote query per Moment is not acceptable at Timeline scale". The
 * danger is not that this is slow today — one Moment with three comments is fast
 * however it is written — but that the shape which is fast and the shape which is
 * not look identical until there is enough data to tell them apart.
 *
 * So the assertion is about **growth rather than magnitude**: the same query
 * against ten times the media, ten times the discussion and ten times the
 * relationships must cost the same number of statements. A count that moved
 * would mean something in the tree had started asking per row, and would mean it
 * loudly, here, rather than in a month against somebody's real history.
 *
 * Counted by wrapping the pool rather than by reading `pg_stat_statements`: this
 * measures what this application asked for, not what the server happened to be
 * doing, and it is the number a reviewer can reason about.
 */

const config = testAppConfig();

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;
let statements = 0;
const people: Person[] = [];

const EVERYTHING = `query Everything($id: ID!) {
  moment(id: $id) {
    momentId
    caption
    occurrence { start end precision }
    author { userId handle displayName }
    place { disclosure }
    visibility
    commentPolicy
    personalSignificance { significant markedAt }
    media(first: 50) { edges { node { mediaId } } pageInfo { hasNextPage } }
    comments(first: 50) { total edges { node { commentId body } } }
    reactions { enabled total counts { kind count } }
    relationships { relationshipId kind unavailable }
  }
}`;

const JUST_THE_CAPTION = `query JustTheCaption($id: ID!) {
  moment(id: $id) { momentId caption }
}`;

/**
 * A pool that counts what it is asked.
 *
 * A proxy rather than a subclass, so nothing about the real pool's behaviour
 * changes — every statement still goes to PostgreSQL, and the count is a
 * side-effect of passing through.
 *
 * @param pool - The real connection.
 * @returns The same pool, counting.
 */
function counting(pool: Pool): Pool {
  return new Proxy(pool, {
    get(target, property, receiver): unknown {
      if (property !== "query") {
        return Reflect.get(target, property, receiver);
      }

      return (...args: unknown[]): unknown => {
        statements += 1;

        return (target.query as (...passed: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

/** Somebody new, with a Session they can read through. */
async function signedInPerson(): Promise<Person & { token: string }> {
  const created = await createPerson(directory.pool);
  const sessionId = randomUUID();

  people.push(created);

  await directory.pool.query(
    `INSERT INTO sessions (session_id, identity_id, created_at, expires_at, revoked_at)
     VALUES ($1, $2, now(), now() + interval '1 hour', NULL)`,
    [sessionId, created.identityId],
  );

  const token = await new SignJWT({ sid: sessionId, uid: created.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(created.identityId)
    .setIssuer(config.auth.issuer)
    .setAudience(config.auth.audience)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(config.auth.jwtSecret);

  return { ...created, token };
}

/**
 * Ask, and report what it cost.
 *
 * @param query - The document.
 * @param momentId - Which Moment.
 * @param token - The credential.
 * @returns How many statements the request issued, and the body, so a test can
 *   prove it was actually answered rather than cheaply refused.
 */
async function costOf(
  query: string,
  momentId: string,
  token: string,
): Promise<{ cost: number; body: { data: Record<string, unknown> | null; errors?: unknown[] } }> {
  statements = 0;

  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${token}` },
    payload: { query, variables: { id: momentId } },
  });

  return { cost: statements, body: response.json() };
}

/**
 * A Moment with a given amount of everything hanging off it.
 *
 * @param author - Who records it.
 * @param scale - How many media, comments and relationships.
 * @returns The Moment's identifier.
 */
async function momentWith(author: Person, scale: number): Promise<string> {
  const momentId = await createMoment(directory.pool, author.userId);

  await attachMedia(directory.pool, momentId, author.userId, scale);

  for (let index = 0; index < scale; index += 1) {
    const commentId = await createComment(directory.pool, momentId, author.userId, {
      body: `comment ${index}`,
    });

    await directory.pool.query(
      `INSERT INTO comment_reactions (comment_id, user_id, kind, created_at, updated_at)
       VALUES ($1, $2, 'loved', now(), now())`,
      [commentId, author.userId],
    );
    await directory.pool.query(
      "INSERT INTO comment_mentions (comment_id, user_id, created_at) VALUES ($1, $2, now())",
      [commentId, author.userId],
    );

    const other = await createMoment(directory.pool, author.userId);

    await directory.pool.query(
      `INSERT INTO moment_relationships (relationship_id, source_moment_id, target_moment_id,
                                         kind, origin, asserted_by_user_id)
       VALUES ($1, $2, $3, 'related_to', 'asserted', $4)`,
      [randomUUID(), momentId, other, author.userId],
    );
  }

  await directory.pool.query(
    "INSERT INTO moment_reactions (moment_id, user_id, kind) VALUES ($1, $2, 'loved')",
    [momentId, author.userId],
  );

  return momentId;
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
      // Counted too: the Session lookup is part of what a request costs, and
      // leaving it out would let a regression hide behind it.
      sessions: new SessionRepository(counting(directory.pool)),
      eligibility: new TimelineEligibilityResolver(asQueryable(counting(directory.pool))),
      directory: counting(directory.pool),
    },
  });
});

afterAll(async () => {
  await removePeople(directory.pool, people);
  await app.close();
  await store.close();
  await directory.close();
});

describe("what a Moment costs", () => {
  it("costs the same against ten times the history", async () => {
    // The assertion this suite exists for. Magnitude is a judgement; growth is
    // a fact, and a tree that started asking per row would move this number.
    const author = await signedInPerson();
    const small = await momentWith(author, 1);
    const large = await momentWith(author, 10);

    const cheap = await costOf(EVERYTHING, small, author.token);
    const dear = await costOf(EVERYTHING, large, author.token);

    assert.equal(cheap.body.errors, undefined, JSON.stringify(cheap.body.errors));
    assert.equal(dear.body.errors, undefined, JSON.stringify(dear.body.errors));
    assert.equal(
      dear.cost,
      cheap.cost,
      `ten times the history cost ${dear.cost} statements against ${cheap.cost}`,
    );
  });

  it("stays within a handful of statements for the fullest selection", async () => {
    // A ceiling as well as a slope. Growth alone would be satisfied by a query
    // that is uniformly expensive, and the point is that opening a Moment is a
    // small, fixed number of round trips.
    const author = await signedInPerson();
    const momentId = await momentWith(author, 5);

    const { cost, body } = await costOf(EVERYTHING, momentId, author.token);

    assert.equal(body.errors, undefined, JSON.stringify(body.errors));
    // Eight when this was written: the Session, the Viewer's age, the Moment,
    // its media, its discussion, that discussion's count, its reactions and its
    // relationships. Ten leaves room for a field to be added deliberately and
    // none for one to arrive by accident.
    assert.ok(cost <= 10, `the fullest selection cost ${cost} statements`);
  });

  it("actually answered, rather than costing little by refusing", async () => {
    // The guard that keeps the numbers above honest: a Moment that came back
    // null would be cheap and would prove nothing.
    const author = await signedInPerson();
    const momentId = await momentWith(author, 3);

    const { body } = await costOf(EVERYTHING, momentId, author.token);
    const moment = body.data?.["moment"] as Record<string, unknown>;

    assert.equal(moment["momentId"], momentId);
    assert.equal((moment["media"] as { edges: unknown[] }).edges.length, 3);
    assert.equal((moment["comments"] as { total: number }).total, 3);
    assert.equal((moment["relationships"] as unknown[]).length, 3);
  });

  it("charges nothing for the fields a client did not select", async () => {
    // Every field beyond the Moment itself is paid for on selection. A caption
    // costs the Session, the Viewer's age and the Moment — and nothing else.
    const author = await signedInPerson();
    const momentId = await momentWith(author, 10);

    const everything = await costOf(EVERYTHING, momentId, author.token);
    const little = await costOf(JUST_THE_CAPTION, momentId, author.token);

    assert.ok(
      little.cost < everything.cost,
      `a caption cost ${little.cost} where everything cost ${everything.cost}`,
    );
    // Three: the Session, the Viewer's age, and the Moment.
    assert.ok(little.cost <= 3, `a caption cost ${little.cost} statements`);
  });

  it("counts a discussion only when the count is asked for", async () => {
    const author = await signedInPerson();
    const momentId = await momentWith(author, 4);

    const withTotal = await costOf(
      `query WithTotal($id: ID!) { moment(id: $id) { comments(first: 10) { total edges { node { commentId } } } } }`,
      momentId,
      author.token,
    );
    const withoutTotal = await costOf(
      `query WithoutTotal($id: ID!) { moment(id: $id) { comments(first: 10) { edges { node { commentId } } } } }`,
      momentId,
      author.token,
    );

    assert.equal(withTotal.cost, withoutTotal.cost + 1);
  });

  it("asks nothing about reactions that are switched off", async () => {
    const author = await signedInPerson();
    const on = await createMoment(directory.pool, author.userId);
    const off = await createMoment(directory.pool, author.userId, { reactionsEnabled: false });
    const query = `query Reactions($id: ID!) { moment(id: $id) { reactions { enabled total } } }`;

    const enabled = await costOf(query, on, author.token);
    const disabled = await costOf(query, off, author.token);

    assert.equal(disabled.cost, enabled.cost - 1);
  });
});
