import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  asClickHouseDateTime,
  toRecord,
  type TimelineRow,
} from "@chronologity/timeline-derivation";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, it } from "vitest";
import { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import { SessionRepository } from "../auth/session.repository.js";
import type { AppConfig } from "../config/app-config.js";
import { createReadStore, type ReadStore } from "../read-models/clickhouse/client.js";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { asQueryable } from "../read-models/postgres/queryable.js";
import { buildApp } from "../server/app.js";
import { testAppConfig } from "../testing/app-config.js";

/**
 * Walking a Timeline, against the stores it is actually walked in.
 *
 * The first time this service answers with history, and the questions it settles
 * cannot be settled anywhere else: whether the statements this application
 * writes reach the projection the API's projector fills, whether the eligibility
 * rule pushed into the `WHERE` withholds what it should, and whether a cursor
 * issued from one page resumes the next — which is a claim about ClickHouse's
 * tuple comparison as much as about this code.
 *
 * It projects under a version of its own and removes it afterwards. The table is
 * shared, and a projection version left behind is history that never happened,
 * visible to every later run.
 *
 * State is arranged by SQL and by direct projection, because the fixtures that
 * would otherwise build it live in `apps/api`, which this application may not
 * import. That is a test running under the developer's role, never application
 * code: this service reads and never writes.
 */

const VERSION = `test-${randomUUID().slice(0, 8)}`;
const base = testAppConfig();
const config: AppConfig = {
  ...base,
  clickhouse: { ...base.clickhouse, projectionVersion: VERSION },
};

const OWNER = randomUUID();
const OWNER_IDENTITY = randomUUID();
const OWNER_SESSION = randomUUID();

const FRIEND = randomUUID();

const CLOSED = randomUUID();
const CLOSED_IDENTITY = randomUUID();
const CLOSED_SESSION = randomUUID();

const PLACE = randomUUID();

const OWN_2020 = randomUUID();
const OWN_2018 = randomUUID();
const OWN_2015 = randomUUID();
const OWN_2010 = randomUUID();
const FRIEND_2021 = randomUUID();
const FRIEND_2012 = randomUUID();
const CLOSED_2019 = randomUUID();

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;

const HEAD = `query Head($view: TimelineViewInput!) {
  timelineHead(view: $view) {
    __typename
    ... on ReadableTimelineEntry { momentId occurredAt occurrenceOffsetMinutes visibility }
    ... on WithheldTimelineEntry { momentId occurredAt }
  }
}`;

const PAGE = `query Page(
  $view: TimelineViewInput!
  $first: Int
  $after: Cursor
  $last: Int
  $before: Cursor
) {
  timeline(view: $view, first: $first, after: $after, last: $last, before: $before) {
    edges {
      cursor
      node {
        __typename
        ... on ReadableTimelineEntry { momentId occurredAt }
        ... on WithheldTimelineEntry { momentId occurredAt }
      }
    }
    pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    scope { type id }
  }
}`;

const tokenFor = async (identityId: string, sessionId: string, userId: string): Promise<string> =>
  new SignJWT({ sid: sessionId, uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identityId)
    .setIssuer(config.auth.issuer)
    .setAudience(config.auth.audience)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(config.auth.jwtSecret);

/**
 * Ask the read contract a question.
 *
 * @param query - The document.
 * @param variables - Its variables.
 * @param token - The credential, or undefined to ask as nobody.
 * @returns The parsed response body.
 */
async function ask(
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<{ data: Record<string, unknown> | null; errors?: { message: string; extensions?: { code?: string } }[] }> {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    payload: { query, variables },
  });

  return response.json();
}

/** A person's own history, as a view. */
const own = (userId: string) => ({ scope: { type: "PERSON", id: userId } });

/**
 * Put a Moment into the Timeline projection, and into the scopes it belongs to.
 *
 * @param moment - Which Moment, when it happened, whose it is and how visible.
 * @param scopes - The contexts it belongs to: the people whose Timelines carry
 *   it, and the place it happened at.
 * @returns Nothing.
 */
async function project(
  moment: {
    momentId: string;
    authorUserId: string;
    occurredAt: string;
    recordedAt: string;
    visibility: string;
  },
  scopes: { type: string; id: string }[],
): Promise<void> {
  const row: TimelineRow = {
    momentId: moment.momentId,
    authorUserId: moment.authorUserId,
    occurredAt: new Date(moment.occurredAt),
    recordedAt: new Date(moment.recordedAt),
    occurrenceEnd: new Date(moment.occurredAt),
    occurrencePrecision: "instant",
    occurrenceOffsetMinutes: 60,
    visibility: moment.visibility as TimelineRow["visibility"],
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
    values: scopes.map((scope) => ({
      context_type: scope.type,
      context_id: scope.id,
      occurred_at: asClickHouseDateTime(row.occurredAt),
      moment_id: row.momentId,
      author_user_id: row.authorUserId,
      visibility: row.visibility,
      moderation_state: row.moderationState,
      projected_at: asClickHouseDateTime(projectedAt),
      projection_version: VERSION,
    })),
    format: "JSONEachRow",
  });
}

beforeAll(async () => {
  store = createReadStore(config.clickhouse);
  directory = createDirectory(config.database);

  const present = await directory.pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.sessions') IS NOT NULL AS exists",
  );

  if (present.rows[0]?.exists !== true) {
    throw new Error("The schema is missing. The API owns it: run `pnpm db:migrate` and try again.");
  }

  for (const [userId, identityId] of [
    [OWNER, OWNER_IDENTITY],
    [FRIEND, randomUUID()],
    [CLOSED, CLOSED_IDENTITY],
  ] as const) {
    await directory.pool.query(
      "INSERT INTO identities (identity_id, created_at) VALUES ($1, now())",
      [identityId],
    );
    await directory.pool.query(
      `INSERT INTO users (user_id, identity_id, handle, display_name, status, created_at)
       VALUES ($1, $2, $3, $3, 'active', now())`,
      [userId, identityId, `h-${userId.slice(0, 8)}`],
    );
    await directory.pool.query(
      `INSERT INTO user_restricted_data (user_id, date_of_birth, minimum_age_at_creation, recorded_at)
       VALUES ($1, CURRENT_DATE - make_interval(years => 30), 13, now())`,
      [userId],
    );
  }

  // The one person who has turned their Timeline off.
  await directory.pool.query(
    `INSERT INTO user_preferences (user_id, timeline_is_public, updated_at)
     VALUES ($1, false, now())
     ON CONFLICT (user_id) DO UPDATE SET timeline_is_public = false`,
    [CLOSED],
  );

  await directory.pool.query(
    `INSERT INTO sessions (session_id, identity_id, created_at, expires_at, revoked_at)
     VALUES ($1, $2, now(), now() + interval '1 hour', NULL),
            ($3, $4, now(), now() + interval '1 hour', NULL)`,
    [OWNER_SESSION, OWNER_IDENTITY, CLOSED_SESSION, CLOSED_IDENTITY],
  );

  // Recording order is deliberately not occurrence order, and the oldest
  // occurrence is the newest recording: a head that ordered by when things were
  // entered would answer 2010 rather than 2020.
  await project(
    { momentId: OWN_2020, authorUserId: OWNER, occurredAt: "2020-06-01T12:00:00.000Z", recordedAt: "2021-01-01T00:00:00.000Z", visibility: "public" },
    [{ type: "person", id: OWNER }],
  );
  await project(
    { momentId: OWN_2018, authorUserId: FRIEND, occurredAt: "2018-04-01T12:00:00.000Z", recordedAt: "2019-01-01T00:00:00.000Z", visibility: "private" },
    [
      { type: "person", id: OWNER },
      { type: "person", id: FRIEND },
      { type: "location", id: PLACE },
    ],
  );
  await project(
    { momentId: OWN_2015, authorUserId: OWNER, occurredAt: "2015-03-01T12:00:00.000Z", recordedAt: "2016-01-01T00:00:00.000Z", visibility: "public" },
    [
      { type: "person", id: OWNER },
      { type: "location", id: PLACE },
    ],
  );
  await project(
    { momentId: OWN_2010, authorUserId: OWNER, occurredAt: "2010-01-01T12:00:00.000Z", recordedAt: "2026-01-05T00:00:00.000Z", visibility: "public" },
    [{ type: "person", id: OWNER }],
  );
  await project(
    { momentId: FRIEND_2021, authorUserId: FRIEND, occurredAt: "2021-08-01T12:00:00.000Z", recordedAt: "2021-08-02T00:00:00.000Z", visibility: "public" },
    [{ type: "person", id: FRIEND }],
  );
  await project(
    { momentId: FRIEND_2012, authorUserId: FRIEND, occurredAt: "2012-02-01T12:00:00.000Z", recordedAt: "2012-02-02T00:00:00.000Z", visibility: "public" },
    [{ type: "person", id: FRIEND }],
  );
  await project(
    { momentId: CLOSED_2019, authorUserId: CLOSED, occurredAt: "2019-09-01T12:00:00.000Z", recordedAt: "2019-09-02T00:00:00.000Z", visibility: "public" },
    [{ type: "person", id: CLOSED }],
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
  const everybody = [OWNER, FRIEND, CLOSED];
  const identities = [OWNER_IDENTITY, CLOSED_IDENTITY];

  await directory.pool.query("DELETE FROM sessions WHERE identity_id = ANY($1)", [identities]);
  await directory.pool.query("DELETE FROM user_restricted_data WHERE user_id = ANY($1)", [everybody]);
  await directory.pool.query("DELETE FROM user_preferences WHERE user_id = ANY($1)", [everybody]);

  const created = await directory.pool.query<{ identity_id: string }>(
    "SELECT identity_id FROM users WHERE user_id = ANY($1)",
    [everybody],
  );

  await directory.pool.query("DELETE FROM users WHERE user_id = ANY($1)", [everybody]);
  await directory.pool.query("DELETE FROM identities WHERE identity_id = ANY($1)", [
    created.rows.map((row) => row.identity_id),
  ]);

  // Queued rather than awaited, and that is measured rather than cautious.
  // `lightweight_deletes_sync` defaults to 2, so `DELETE FROM` blocks until the
  // mutation has been applied everywhere: 16.3s and 4.7s on these two tables
  // against a version matching no rows at all. Two of those plus the PostgreSQL
  // cleanup exceeds this suite's 30s hook timeout, which fails the file while
  // every test in it passes — which is exactly how this was found.
  //
  // Safe to queue because nothing but this run reads this projection version,
  // so when the rows actually go is nobody's business.
  for (const table of ["timeline_moments", "timeline_moment_contexts"]) {
    await store.client.command({
      query: `DELETE FROM ${table} WHERE projection_version = {version: String}`,
      query_params: { version: VERSION },
      clickhouse_settings: { lightweight_deletes_sync: "0" },
    });
  }

  await app.close();
  await store.close();
  await directory.close();
});

/** The Moments a page holds, in the order it holds them. */
const momentsIn = (connection: unknown): string[] =>
  (connection as { edges: { node: { momentId: string } }[] }).edges.map((edge) => edge.node.momentId);

describe("where a Timeline opens", () => {
  it("opens at the newest occurrence rather than the newest recording", async () => {
    // The 2010 Moment was entered most recently of all. A head ordered by when
    // things were recorded would answer it, which would put somebody at the
    // wrong end of their own history the moment they backfilled anything.
    const token = await tokenFor(OWNER_IDENTITY, OWNER_SESSION, OWNER);

    const body = await ask(HEAD, { view: own(OWNER) }, token);

    assert.equal((body.data?.["timelineHead"] as { momentId: string }).momentId, OWN_2020);
  });

  it("opens at nothing for a Timeline closed to the reader", async () => {
    const token = await tokenFor(OWNER_IDENTITY, OWNER_SESSION, OWNER);

    const body = await ask(HEAD, { view: own(CLOSED) }, token);

    assert.equal(body.data?.["timelineHead"], null);
  });
});

describe("walking history", () => {
  it("runs newest first, and says there is more further back", async () => {
    const token = await tokenFor(OWNER_IDENTITY, OWNER_SESSION, OWNER);

    const body = await ask(PAGE, { view: own(OWNER), first: 2 }, token);
    const connection = body.data?.["timeline"] as { pageInfo: Record<string, unknown> };

    assert.deepEqual(momentsIn(connection), [OWN_2020, OWN_2018]);
    assert.equal(connection.pageInfo["hasNextPage"], true);
    assert.equal(connection.pageInfo["hasPreviousPage"], false);
  });

  it("returns the same Moments in the same order paging back and then forward", async () => {
    // `timeline.md:824` asks that neither direction be substantially harder.
    // Returning a page that read backwards depending on how it was reached
    // would be worse than harder: it would be a different Timeline.
    const token = await tokenFor(OWNER_IDENTITY, OWNER_SESSION, OWNER);

    const first = await ask(PAGE, { view: own(OWNER), first: 2 }, token);
    const firstPage = first.data?.["timeline"] as { pageInfo: { endCursor: string } };

    const second = await ask(
      PAGE,
      { view: own(OWNER), first: 2, after: firstPage.pageInfo.endCursor },
      token,
    );
    const secondPage = second.data?.["timeline"] as { pageInfo: { startCursor: string } };

    const back = await ask(
      PAGE,
      { view: own(OWNER), last: 2, before: secondPage.pageInfo.startCursor },
      token,
    );

    assert.deepEqual(momentsIn(secondPage), [OWN_2015, OWN_2010]);
    assert.deepEqual(momentsIn(back.data?.["timeline"]), momentsIn(firstPage));
  });

  it("says history ran out at the far end", async () => {
    const token = await tokenFor(OWNER_IDENTITY, OWNER_SESSION, OWNER);

    const body = await ask(PAGE, { view: own(OWNER), first: 50 }, token);
    const connection = body.data?.["timeline"] as { pageInfo: Record<string, unknown> };

    assert.equal(momentsIn(connection).length, 4);
    assert.equal(connection.pageInfo["hasNextPage"], false);
  });
});

describe("what a Viewer is entitled to see", () => {
  it("carries a Moment somebody took part in and may not read as its date alone", async () => {
    // Their own history should not have a hole they cannot see the shape of,
    // and accepting participation granted them nothing beyond knowing it
    // happened.
    const token = await tokenFor(OWNER_IDENTITY, OWNER_SESSION, OWNER);

    const body = await ask(PAGE, { view: own(OWNER), first: 50 }, token);
    const nodes = (body.data?.["timeline"] as { edges: { node: Record<string, unknown> }[] }).edges;
    const withheld = nodes.find((edge) => edge.node["momentId"] === OWN_2018)?.node;

    assert.equal(withheld?.["__typename"], "WithheldTimelineEntry");
    assert.ok(withheld?.["occurredAt"] !== undefined);
  });

  it("leaves that Moment out of the place it happened entirely", async () => {
    // The asymmetry the product requires: a person's own Timeline reports, and
    // every other Timeline filters, because a Moment's existence at a place is
    // not the reader's to know.
    const token = await tokenFor(OWNER_IDENTITY, OWNER_SESSION, OWNER);

    const body = await ask(
      PAGE,
      { view: { scope: { type: "LOCATION", id: PLACE } }, first: 50 },
      token,
    );

    assert.deepEqual(momentsIn(body.data?.["timeline"]), [OWN_2015]);
  });

  it("answers a closed Timeline empty rather than refusing", async () => {
    // Refusing would say there was something there to refuse.
    const token = await tokenFor(OWNER_IDENTITY, OWNER_SESSION, OWNER);

    const body = await ask(PAGE, { view: own(CLOSED), first: 50 }, token);
    const connection = body.data?.["timeline"] as { pageInfo: Record<string, unknown> };

    assert.equal(body.errors, undefined);
    assert.deepEqual(momentsIn(connection), []);
    assert.equal(connection.pageInfo["startCursor"], null);
    assert.equal(connection.pageInfo["hasNextPage"], false);
  });

  it("still opens that Timeline to the person whose it is", async () => {
    const token = await tokenFor(CLOSED_IDENTITY, CLOSED_SESSION, CLOSED);

    const body = await ask(PAGE, { view: own(CLOSED), first: 50 }, token);

    assert.deepEqual(momentsIn(body.data?.["timeline"]), [CLOSED_2019]);
  });

  it("refuses to read history for a request that offered no credential", async () => {
    // A Block is between two accounts, so somebody who could read signed out
    // would have routed around one.
    const body = await ask(PAGE, { view: own(OWNER), first: 5 }, undefined);

    assert.equal(body.errors?.[0]?.extensions?.code, "AUTHENTICATION_FAILED");
  });
});

describe("cursors", () => {
  it("names a position rather than conferring access to the Timeline it came from", async () => {
    // The same cursor, replayed against somebody else's history, pages that
    // history from that position. It is a place in time and never a grant.
    const token = await tokenFor(OWNER_IDENTITY, OWNER_SESSION, OWNER);

    const mine = await ask(PAGE, { view: own(OWNER), first: 1 }, token);
    const cursor = (mine.data?.["timeline"] as { pageInfo: { endCursor: string } }).pageInfo
      .endCursor;

    const theirs = await ask(PAGE, { view: own(FRIEND), first: 50, after: cursor }, token);

    assert.deepEqual(momentsIn(theirs.data?.["timeline"]), [FRIEND_2012]);
  });

  it("refuses one this Timeline did not issue, as a refusal rather than a failure", async () => {
    // The end-to-end proof the schema phase could not give, because until now
    // no query took a `Cursor`. A decoding error reaching the formatter unwrapped
    // would read as the service falling over.
    const token = await tokenFor(OWNER_IDENTITY, OWNER_SESSION, OWNER);

    const body = await ask(PAGE, { view: own(OWNER), first: 5, after: "not-a-cursor" }, token);

    assert.equal(body.errors?.[0]?.extensions?.code, "VALIDATION_FAILED");
    assert.ok(!(body.errors?.[0]?.message ?? "").includes("JSON"));
  });
});
