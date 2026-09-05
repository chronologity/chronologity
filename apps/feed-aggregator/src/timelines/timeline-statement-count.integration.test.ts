import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  asClickHouseDateTime,
  toRecord,
  TimelineEligibilityResolver,
  type TimelineRow,
} from "@chronologity/timeline-derivation";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, it } from "vitest";
import { SessionRepository } from "../auth/session.repository.js";
import type { AppConfig } from "../config/app-config.js";
import { createReadStore, type ReadStore } from "../read-models/clickhouse/client.js";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { asQueryable } from "../read-models/postgres/queryable.js";
import { buildApp } from "../server/app.js";
import { testAppConfig } from "../testing/app-config.js";
import { countingPool, countingStore, newCost } from "../testing/counting.js";
import { createMoment, createPerson, removePeople, type Person } from "../testing/moment-fixtures.js";

/**
 * What paging a Timeline costs.
 *
 * **The assertion this exists for is that a Timeline page touches PostgreSQL a
 * fixed number of times, whatever it returns.** `feed.md:307-323` permits this
 * service to read the authoritative tables "on demand" and forbids it while
 * paging — "the distinction is per-item versus on-demand: paging a Timeline must
 * not touch these tables, and opening a single Moment does." Nothing asserted
 * that until now.
 *
 * It is written **before** any batching exists, deliberately. Batching makes a
 * per-item PostgreSQL read *cheap*, and cheap is exactly the condition under
 * which somebody adds one to a Timeline node and nothing complains. This is the
 * thing that complains.
 *
 * Growth rather than magnitude, as everywhere else here: the numbers below are a
 * machine on a day, and what is claimed is that they do not move with the size
 * of the page.
 */

const VERSION = `test-${randomUUID().slice(0, 8)}`;
const base = testAppConfig();
const config: AppConfig = {
  ...base,
  clickhouse: { ...base.clickhouse, projectionVersion: VERSION },
};

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;
let owner: Person & { token: string };

const people: Person[] = [];
const cost = newCost();

const PAGE = `query Page($view: TimelineViewInput!, $first: Int) {
  timeline(view: $view, first: $first) {
    edges { cursor node { __typename ... on ReadableTimelineEntry { momentId occurredAt visibility } } }
    pageInfo { hasNextPage hasPreviousPage }
    scope { type id }
  }
}`;

const HEAD = `query Head($view: TimelineViewInput!) {
  timelineHead(view: $view) { ... on ReadableTimelineEntry { momentId } }
}`;

/**
 * Ask, and report what it cost in both stores.
 *
 * @param query - The document.
 * @param variables - Its variables.
 * @returns The cost per store, and the body so a test can prove it answered.
 */
async function costOf(
  query: string,
  variables: Record<string, unknown>,
): Promise<{ postgres: number; clickhouse: number; body: { data: unknown; errors?: unknown[] } }> {
  cost.postgres = 0;
  cost.clickhouse = 0;

  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${owner.token}` },
    payload: { query, variables },
  });

  return { postgres: cost.postgres, clickhouse: cost.clickhouse, body: response.json() };
}

/**
 * Record a Moment and project it onto the owner's Timeline.
 *
 * @param occurredAt - When it happened.
 * @returns Nothing.
 */
async function record(occurredAt: string): Promise<void> {
  const momentId = await createMoment(directory.pool, owner.userId, { occurredAt });
  const row: TimelineRow = {
    momentId,
    authorUserId: owner.userId,
    occurredAt: new Date(occurredAt),
    recordedAt: new Date(),
    occurrenceEnd: new Date(occurredAt),
    occurrencePrecision: "instant",
    occurrenceOffsetMinutes: 0,
    visibility: "public",
    moderationState: "allowed",
    discoverable: true,
  };
  const projectedAt = new Date();

  await store.client.insert({
    table: "timeline_moments",
    values: [toRecord(row, projectedAt, VERSION)],
    format: "JSONEachRow",
  });
  await store.client.insert({
    table: "timeline_moment_contexts",
    values: [
      {
        context_type: "person",
        context_id: owner.userId,
        occurred_at: asClickHouseDateTime(row.occurredAt),
        moment_id: momentId,
        author_user_id: owner.userId,
        visibility: row.visibility,
        moderation_state: row.moderationState,
        projected_at: asClickHouseDateTime(projectedAt),
        projection_version: VERSION,
      },
    ],
    format: "JSONEachRow",
  });
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

  owner = {
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

  // Projected before the app is built, so these inserts are not counted — the
  // counting store refuses writes, which is the point of it.
  for (let index = 0; index < 25; index += 1) {
    await record(`199${index % 10}-0${(index % 9) + 1}-01T12:00:00.000Z`);
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
  for (const table of ["timeline_moment_contexts", "timeline_moments"]) {
    await store.client.command({
      query: `ALTER TABLE ${table} DELETE WHERE projection_version = '${VERSION}'`,
      clickhouse_settings: { mutations_sync: "2" },
    });
  }

  await removePeople(directory.pool, people);
  await app.close();
  await store.close();
  await directory.close();
});

describe("what paging a Timeline costs", () => {
  it("touches PostgreSQL the same number of times for one Moment as for twenty-five", async () => {
    // The assertion this file exists for. A page's PostgreSQL cost is the
    // Session and the Viewer's eligibility — facts about the reader, asked once
    // — and nothing about the Moments. If it ever moves with the page size,
    // something reads the authoritative tables per row.
    const view = { scope: { type: "PERSON", id: owner.userId } };
    const one = await costOf(PAGE, { view, first: 1 });
    const many = await costOf(PAGE, { view, first: 25 });

    assert.equal(many.postgres, one.postgres);
  });

  it("reads ClickHouse once for a page, however large", async () => {
    const view = { scope: { type: "PERSON", id: owner.userId } };
    const one = await costOf(PAGE, { view, first: 1 });
    const many = await costOf(PAGE, { view, first: 25 });

    assert.equal(one.clickhouse, 1);
    assert.equal(many.clickhouse, 1);
  });

  it("actually returned the history it was asked for", async () => {
    // Without this the numbers above could be the cost of refusing.
    const { body } = await costOf(PAGE, {
      view: { scope: { type: "PERSON", id: owner.userId } },
      first: 25,
    });

    assert.equal(body.errors, undefined);
    assert.equal(
      (body.data as { timeline: { edges: unknown[] } }).timeline.edges.length,
      25,
    );
  });

  it("opens a Timeline at its head for one ClickHouse read and no more PostgreSQL", async () => {
    const view = { scope: { type: "PERSON", id: owner.userId } };
    const head = await costOf(HEAD, { view });
    const page = await costOf(PAGE, { view, first: 1 });

    assert.equal(head.clickhouse, 1);
    assert.equal(head.postgres, page.postgres);
  });

  it("stays within a handful of PostgreSQL statements for a page", async () => {
    // Magnitude is a judgement and this ceiling is generous. Three when written:
    // the Session, and the two reads the Viewer's eligibility takes.
    const { postgres } = await costOf(PAGE, {
      view: { scope: { type: "PERSON", id: owner.userId } },
      first: 25,
    });

    assert.ok(postgres <= 5, `a Timeline page cost ${postgres} PostgreSQL statements`);
  });
});
