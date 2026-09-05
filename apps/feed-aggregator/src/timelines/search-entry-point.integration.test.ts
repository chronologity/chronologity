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
import {
  attachToEvent,
  createMoment,
  createPerson,
  createPlace,
  createRealWorldEvent,
  indexDocument,
  removePeople,
  type Person,
} from "../testing/moment-fixtures.js";

/**
 * Arriving from a search.
 *
 * Somebody searched, tapped a result, and is being taken to where that thing
 * sits in history. What arrives here is a kind and an identifier — exactly what
 * the API's result carried — and **nothing about it is evidence of anything.**
 * `architecture/search.md:439`: "A Search result reference is not proof the
 * destination remains visible."
 *
 * Three things are settled here and nowhere else.
 *
 * **Two checks, both of them, in that order.** Still findable, then still
 * visible to this reader. Neither implies the other: something can be readable
 * and withdrawn from Search, or indexed and since made private. The index lags
 * and the refusal does not.
 *
 * **The server does the working out, which is what earns the reason.** An app
 * hands back what it was given and does not choose an anchor; `SEARCH_RESULT`
 * therefore names work done here rather than echoing a claim (ADR-145, ADR-148).
 *
 * **Every refusal is one answer.** Never indexed, withdrawn from the index, not
 * visible, on a Timeline that is shut — all four answer identically to a thing
 * that never existed, asserted by deep equality rather than by eye.
 */

const VERSION = `test-${randomUUID().slice(0, 8)}`;
const base = testAppConfig();
const config: AppConfig = {
  ...base,
  clickhouse: { ...base.clickhouse, projectionVersion: VERSION },
  search: { indexVersion: "search-v1" },
};

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;

let reader: Person & { token: string };
let author: Person;
let closed: Person;
let neighbour: Person;

const people: Person[] = [];
let found = "";
let later = "";
let place = "";
let occasion = "";
let hidden = "";
let unlisted = "";
let behindTheDoor = "";
let middle = "";
let before = "";
let after = "";
const indexed: string[] = [];

const AROUND = `query Around($view: TimelineViewInput!, $anchor: TimelineAnchorInput!) {
  timelineAround(view: $view, anchor: $anchor, first: 20) {
    anchoredAt
    scope { type id }
    reason
    at { __typename ... on ReadableTimelineEntry { momentId } }
    older { edges { node { ... on ReadableTimelineEntry { momentId } } } }
    newer { edges { node { ... on ReadableTimelineEntry { momentId } } } }
  }
}`;

interface Landing {
  anchoredAt: string | null;
  scope: { type: string; id: string };
  reason: string;
  at: { momentId?: string } | null;
  older: { edges: { node: { momentId?: string } }[] };
  newer: { edges: { node: { momentId?: string } }[] };
}

/**
 * Project a Moment into the scopes it belongs to.
 *
 * @param momentId - Which Moment.
 * @param authorUserId - Who recorded it.
 * @param occurredAt - When it happened.
 * @param scopes - The contexts carrying it.
 * @param visibility - How visible it is.
 * @returns Nothing.
 */
async function project(
  momentId: string,
  authorUserId: string,
  occurredAt: string,
  scopes: { type: string; id: string }[],
  visibility = "public",
): Promise<void> {
  const row: TimelineRow = {
    momentId,
    authorUserId,
    occurredAt: new Date(occurredAt),
    recordedAt: new Date(),
    occurrenceEnd: new Date(occurredAt),
    occurrencePrecision: "instant",
    occurrenceOffsetMinutes: 0,
    visibility: visibility as TimelineRow["visibility"],
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
      moment_id: momentId,
      author_user_id: authorUserId,
      visibility: row.visibility,
      moderation_state: row.moderationState,
      projected_at: asClickHouseDateTime(projectedAt),
      projection_version: VERSION,
    })),
    format: "JSONEachRow",
  });
}

/**
 * Index something, and remember it so the suite can clean up after itself.
 *
 * @param entityType - What kind of thing.
 * @param entityId - Which one.
 * @param over - Anything the document needs different.
 * @returns Nothing.
 */
async function index(
  entityType: "moment" | "user" | "event" | "location",
  entityId: string,
  over: { searchable?: boolean; deleted?: boolean } = {},
): Promise<void> {
  await indexDocument(directory.pool, entityType, entityId, over);
  indexed.push(entityId);
}

/**
 * Open something that was found, from the reader's own Timeline.
 *
 * @param entityType - What kind of thing it is.
 * @param entityId - Which one.
 * @param at - Where in its history to land, for a kind that spans one.
 * @returns The landing.
 */
async function open(
  entityType: string,
  entityId: string,
  at?: string,
): Promise<Landing> {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${reader.token}` },
    payload: {
      query: AROUND,
      variables: {
        view: { scope: { type: "PERSON", id: reader.userId } },
        anchor: { searchResult: { entityType, entityId, ...(at === undefined ? {} : { at }) } },
      },
    },
  });
  const body = response.json() as {
    data: { timelineAround: Landing } | null;
    errors?: { message: string }[];
  };

  assert.equal(body.errors, undefined, JSON.stringify(body.errors));

  return (body.data as { timelineAround: Landing }).timelineAround;
}

/**
 * What every refused reference must be indistinguishable from.
 *
 * The scope echoed back is the reader's own — what they were reading — because a
 * refusal that named the destination's scope would confirm the destination.
 *
 * @returns The empty landing.
 */
const nowhere = () => ({
  anchoredAt: null,
  scope: { type: "PERSON", id: reader.userId },
  reason: "SEARCH_RESULT",
  at: null,
  older: { edges: [] },
  newer: { edges: [] },
});

beforeAll(async () => {
  store = createReadStore(config.clickhouse);
  directory = createDirectory(config.database);

  const present = await directory.pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.search_documents') IS NOT NULL AS exists",
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

  const created = await createPerson(directory.pool);
  const sessionId = randomUUID();

  author = await createPerson(directory.pool);
  closed = await createPerson(directory.pool);
  neighbour = await createPerson(directory.pool);
  people.push(created, author, closed, neighbour);

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

  // The author's own history: two Moments, so a landing has something either
  // side of it and the newest is distinguishable from the oldest.
  found = await createMoment(directory.pool, author.userId, {
    occurredAt: "1998-07-04T19:30:00.000Z",
  });
  later = await createMoment(directory.pool, author.userId, {
    occurredAt: "1999-06-01T00:00:00.000Z",
  });

  await project(found, author.userId, "1998-07-04T19:30:00.000Z", [
    { type: "person", id: author.userId },
  ]);
  await project(later, author.userId, "1999-06-01T00:00:00.000Z", [
    { type: "person", id: author.userId },
  ]);

  await index("moment", found);
  await index("user", author.userId);

  // A place, with the author's history at it.
  place = await createPlace(directory.pool, found, author.userId, "the old pier");
  await project(found, author.userId, "1998-07-04T19:30:00.000Z", [
    { type: "location", id: place },
  ]);
  await index("location", place);

  // An occasion, declaring its own start.
  occasion = await createRealWorldEvent(directory.pool, author.userId, {
    name: "the summer the pier burned",
    occurrenceStart: "1998-08-01T00:00:00.000Z",
    occurrenceEnd: "1998-08-31T00:00:00.000Z",
  });
  await attachToEvent(directory.pool, found, occasion);
  await project(found, author.userId, "1998-07-04T19:30:00.000Z", [
    { type: "real_world_event", id: occasion },
  ]);
  await index("event", occasion);

  // Indexed, and private. The two checks disagree, which is the point.
  hidden = await createMoment(directory.pool, author.userId, {
    occurredAt: "1998-09-09T00:00:00.000Z",
    visibility: "private",
  });
  await project(hidden, author.userId, "1998-09-09T00:00:00.000Z", [
    { type: "person", id: author.userId },
  ]);
  await index("moment", hidden);

  // Readable, and withdrawn from Search. The two checks disagree the other way.
  unlisted = await createMoment(directory.pool, author.userId, {
    occurredAt: "1998-10-10T00:00:00.000Z",
  });
  await project(unlisted, author.userId, "1998-10-10T00:00:00.000Z", [
    { type: "person", id: author.userId },
  ]);
  await index("moment", unlisted, { searchable: false });

  // Somebody findable whose Timeline is shut, with a public Moment on it.
  await directory.pool.query(
    `INSERT INTO user_preferences (user_id, timeline_is_public)
     VALUES ($1, false)
     ON CONFLICT (user_id) DO UPDATE SET timeline_is_public = false`,
    [closed.userId],
  );
  behindTheDoor = await createMoment(directory.pool, closed.userId, {
    occurredAt: "1999-04-04T00:00:00.000Z",
  });
  await project(behindTheDoor, closed.userId, "1999-04-04T00:00:00.000Z", [
    { type: "person", id: closed.userId },
  ]);
  await index("user", closed.userId);

  // A Timeline of exactly three Moments, belonging to nobody else's test. The
  // pages either side of a landing are asserted whole, and an assertion pinned
  // to the shared author's history would break every time a later case needed
  // another Moment added to it.
  before = await createMoment(directory.pool, neighbour.userId, {
    occurredAt: "2001-01-01T00:00:00.000Z",
  });
  middle = await createMoment(directory.pool, neighbour.userId, {
    occurredAt: "2002-02-02T00:00:00.000Z",
  });
  after = await createMoment(directory.pool, neighbour.userId, {
    occurredAt: "2003-03-03T00:00:00.000Z",
  });

  for (const [momentId, occurredAt] of [
    [before, "2001-01-01T00:00:00.000Z"],
    [middle, "2002-02-02T00:00:00.000Z"],
    [after, "2003-03-03T00:00:00.000Z"],
  ] as const) {
    await project(momentId, neighbour.userId, occurredAt, [
      { type: "person", id: neighbour.userId },
    ]);
  }

  await index("moment", middle);
});

afterAll(async () => {
  await directory.pool.query("DELETE FROM search_documents WHERE entity_id = ANY($1)", [indexed]);
  await removePeople(directory.pool, people);
  await app.close();
  await store.close();
  await directory.close();
});

describe("opening something that was found", () => {
  it("lands on a Moment, and says the search took it there", async () => {
    const landing = await open("MOMENT", found);

    assert.equal(landing.at?.momentId, found);
    assert.equal(landing.reason, "SEARCH_RESULT");
  });

  it("lands in the author's history rather than the Timeline being read", async () => {
    // The reader was reading their own. A Moment they did not record is not on
    // it, and landing at the right instant in the wrong history would be worse
    // than not landing at all.
    const landing = await open("MOMENT", found);

    assert.deepEqual(landing.scope, { type: "PERSON", id: author.userId });
  });

  it("lands in a place, at what happened there", async () => {
    const landing = await open("LOCATION", place);

    assert.deepEqual(landing.scope, { type: "LOCATION", id: place });
    assert.equal(landing.at?.momentId, found);
  });

  it("lands in an occasion, at the start it declared for itself", async () => {
    // An occasion carries its own instant rather than deriving one from the
    // Moments recorded of it — so the landing is August, though the Moment
    // attached to it is July.
    const landing = await open("EVENT", occasion);

    assert.deepEqual(landing.scope, { type: "REAL_WORLD_EVENT", id: occasion });
    assert.equal(landing.anchoredAt, "1998-08-01T00:00:00.000Z");
  });

  it("lands on a person at the newest of their history", async () => {
    // A person is not an occurrence, so there is no instant to land at and the
    // landing is wherever their history reaches.
    const landing = await open("USER", author.userId);

    assert.deepEqual(landing.scope, { type: "PERSON", id: author.userId });
    assert.equal(landing.at?.momentId, later);
  });

  it("reads the stretch either side of where it landed", async () => {
    // The arrival has to be somewhere navigation can continue from, which is
    // the whole point of resolving into Timeline context rather than returning
    // the thing itself. The landing stays in `older` rather than being lifted
    // out of it: a page that came back one shorter depending on whether the
    // destination happened to be a member would be short for a reason its size
    // could not explain.
    const landing = await open("MOMENT", middle);

    assert.deepEqual(
      landing.older.edges.map((edge) => edge.node.momentId),
      [middle, before],
    );
    assert.deepEqual(
      landing.newer.edges.map((edge) => edge.node.momentId),
      [after],
    );
  });

  it("takes a date within an occasion when one is given", async () => {
    const landing = await open("EVENT", occasion, "1998-08-20T00:00:00.000Z");

    assert.equal(landing.anchoredAt, "1998-08-20T00:00:00.000Z");
  });
});

describe("refusing something that was found", () => {
  it("refuses a Moment made private since it was indexed", async () => {
    // The case ADR-118 proves for Search itself, proved again on arrival. The
    // document still says findable; the answer is still nothing.
    assert.deepEqual(await open("MOMENT", hidden), nowhere());
  });

  it("refuses a Moment withdrawn from Search though it stays readable", async () => {
    // The check that only exists because this phase added it. Visibility says
    // yes and findability says no, and a door for things people found should
    // not open onto a thing Search would not have offered.
    assert.deepEqual(await open("MOMENT", unlisted), nowhere());
  });

  it("proves the withdrawn Moment is genuinely still readable", async () => {
    // Without this the test above would pass for the wrong reason, and the new
    // check would be indistinguishable from a broken visibility rule.
    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      headers: { authorization: `Bearer ${reader.token}` },
      payload: {
        query: "query Open($id: ID!) { moment(id: $id) { momentId } }",
        variables: { id: unlisted },
      },
    });
    const body = response.json() as { data: { moment: { momentId: string } | null } };

    assert.equal(body.data.moment?.momentId, unlisted);
  });

  it("refuses a thing nothing ever indexed", async () => {
    assert.deepEqual(await open("MOMENT", randomUUID()), nowhere());
  });

  it("refuses a person whose Timeline is shut", async () => {
    // Findable, and their history is not open. The refusal comes from the
    // destination's own eligibility rather than from the index.
    assert.deepEqual(await open("USER", closed.userId), nowhere());
  });

  it("answers every refusal the same way", async () => {
    // Deep equality across four different reasons for saying no. A client that
    // could tell them apart could tell that something exists.
    const never = await open("LOCATION", randomUUID());
    const shut = await open("USER", closed.userId);
    const madePrivate = await open("MOMENT", hidden);
    const withdrawn = await open("MOMENT", unlisted);

    assert.deepEqual(never, shut);
    assert.deepEqual(shut, madePrivate);
    assert.deepEqual(madePrivate, withdrawn);
  });

  it("refuses an identifier that is not one", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      headers: { authorization: `Bearer ${reader.token}` },
      payload: {
        query: AROUND,
        variables: {
          view: { scope: { type: "PERSON", id: reader.userId } },
          anchor: { searchResult: { entityType: "MOMENT", entityId: "not-a-uuid" } },
        },
      },
    });
    const body = response.json() as { errors?: { message: string }[] };

    assert.ok(body.errors !== undefined);
  });

  it("refuses a reference alongside another destination", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      headers: { authorization: `Bearer ${reader.token}` },
      payload: {
        query: AROUND,
        variables: {
          view: { scope: { type: "PERSON", id: reader.userId } },
          anchor: {
            instant: "1998-07-04T19:30:00.000Z",
            searchResult: { entityType: "MOMENT", entityId: found },
          },
        },
      },
    });
    const body = response.json() as { errors?: { message: string }[] };

    assert.ok(body.errors !== undefined);
  });
});
