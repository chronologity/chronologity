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
  createMoment,
  createPerson,
  createPlace,
  createRealWorldEvent,
  removePeople,
  type Person,
} from "../testing/moment-fixtures.js";

/**
 * Jumping, by every way a destination can be named.
 *
 * Three things are settled here and nowhere else.
 *
 * **A pointer is not a permission.** A relationship, an identifier, an occasion,
 * a span — each names somewhere, and none of them grants the right to go there.
 * Every unreachable destination must answer exactly as one that never existed,
 * which is asserted by deep equality rather than by eye.
 *
 * **A jump that crosses into another Timeline resolves that Timeline's
 * permission afresh.** The audience of a restricted Moment is bounded to the
 * scope it was resolved for, so reusing the source's answer at the destination
 * would silently withhold history the reader is entitled to — a failure
 * indistinguishable from an empty Timeline. The test for it is behavioural: a
 * reader named on the destination's Moment and nowhere in the source's can only
 * see the landing if the destination's scope was asked about.
 *
 * **A significance anchor is what temporal zoom already picked.** Asserted
 * across the two surfaces, because that equality *is* the decision.
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

let reader: Person & { token: string };
let author: Person;

const people: Person[] = [];
const ID: Record<string, string> = {};
let placeId = "";
let occasionId = "";
let relationshipId = "";
let shutRelationshipId = "";
let closed: Person;

const AROUND = `query Around($view: TimelineViewInput!, $anchor: TimelineAnchorInput!) {
  timelineAround(view: $view, anchor: $anchor, first: 20) {
    anchoredAt
    scope { type id }
    reason
    at { __typename ... on ReadableTimelineEntry { momentId occurredAt } }
    older { edges { node { ... on ReadableTimelineEntry { momentId } } }
            pageInfo { hasNextPage hasPreviousPage } scope { type id } }
    newer { edges { node { ... on ReadableTimelineEntry { momentId } } }
            pageInfo { hasNextPage hasPreviousPage } scope { type id } }
  }
}`;

const SPAN = `query Span($view: TimelineViewInput!, $scale: TimelineScale!) {
  temporalDistribution(view: $view, scale: $scale) {
    buckets { startsAt representatives { momentId } }
  }
}`;

/**
 * Project a Moment into the scopes it belongs to.
 *
 * @param momentId - Which Moment.
 * @param authorUserId - Who recorded it.
 * @param occurredAt - When it happened.
 * @param visibility - How visible it is.
 * @param scopes - The contexts carrying it.
 * @returns Nothing.
 */
async function project(
  momentId: string,
  authorUserId: string,
  occurredAt: string,
  visibility: string,
  scopes: { type: string; id: string }[],
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

interface Landing {
  anchoredAt: string | null;
  scope: { type: string; id: string };
  reason: string;
  at: { momentId?: string } | null;
  older: { edges: { node: { momentId?: string } }[]; pageInfo: unknown; scope: unknown };
  newer: { edges: { node: { momentId?: string } }[]; pageInfo: unknown; scope: unknown };
}

/**
 * Jump from the reader's own Timeline.
 *
 * @param anchor - How the destination is named.
 * @param scope - Which Timeline is being read.
 * @returns The landing.
 */
async function jump(
  anchor: Record<string, unknown>,
  scope: { type: string; id: string } = { type: "PERSON", id: reader.userId },
): Promise<Landing> {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${reader.token}` },
    payload: { query: AROUND, variables: { view: { scope }, anchor } },
  });
  const body = response.json() as {
    data: { timelineAround: Landing } | null;
    errors?: { message: string }[];
  };

  assert.equal(body.errors, undefined, JSON.stringify(body.errors));

  return (body.data as { timelineAround: Landing }).timelineAround;
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

  const created = await createPerson(directory.pool);
  const sessionId = randomUUID();

  author = await createPerson(directory.pool);
  people.push(created, author);

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

  // The reader's own history.
  ID.mine = await createMoment(directory.pool, reader.userId, {
    occurredAt: "1998-07-04T19:30:00.000Z",
  });
  ID.mineLater = await createMoment(directory.pool, reader.userId, {
    occurredAt: "1998-11-02T10:00:00.000Z",
  });

  await project(ID.mine, reader.userId, "1998-07-04T19:30:00.000Z", "public", [
    { type: "person", id: reader.userId },
  ]);
  await project(ID.mineLater, reader.userId, "1998-11-02T10:00:00.000Z", "public", [
    { type: "person", id: reader.userId },
  ]);

  // The author's own, on their own Timeline and on nobody else's.
  ID.theirs = await createMoment(directory.pool, author.userId, {
    occurredAt: "1999-03-02T14:00:00.000Z",
  });
  ID.theirsLater = await createMoment(directory.pool, author.userId, {
    occurredAt: "1999-06-01T00:00:00.000Z",
  });

  await project(ID.theirs, author.userId, "1999-03-02T14:00:00.000Z", "public", [
    { type: "person", id: author.userId },
  ]);
  await project(ID.theirsLater, author.userId, "1999-06-01T00:00:00.000Z", "public", [
    { type: "person", id: author.userId },
  ]);

  // Somebody who has turned their Timeline off, with a public Moment on it. The
  // Moment can be opened; their Timeline cannot be read.
  closed = await createPerson(directory.pool);
  people.push(closed);
  await directory.pool.query(
    `INSERT INTO user_preferences (user_id, timeline_is_public)
     VALUES ($1, false)
     ON CONFLICT (user_id) DO UPDATE SET timeline_is_public = false`,
    [closed.userId],
  );
  ID.behindTheDoor = await createMoment(directory.pool, closed.userId, {
    occurredAt: "1999-04-04T00:00:00.000Z",
  });
  await project(ID.behindTheDoor, closed.userId, "1999-04-04T00:00:00.000Z", "public", [
    { type: "person", id: closed.userId },
  ]);
  shutRelationshipId = randomUUID();
  await directory.pool.query(
    `INSERT INTO moment_relationships (relationship_id, source_moment_id, target_moment_id,
                                       kind, origin, asserted_by_user_id)
     VALUES ($1, $2, $3, 'led_to', 'asserted', $4)`,
    [shutRelationshipId, ID.mine, ID.behindTheDoor, reader.userId],
  );

  // A relationship from the reader's Moment to the author's.
  relationshipId = randomUUID();
  await directory.pool.query(
    `INSERT INTO moment_relationships (relationship_id, source_moment_id, target_moment_id,
                                       kind, origin, asserted_by_user_id)
     VALUES ($1, $2, $3, 'led_to', 'asserted', $4)`,
    [relationshipId, ID.mine, ID.theirs, reader.userId],
  );

  // A place and an occasion, each carrying one of the reader's Moments.
  placeId = await createPlace(directory.pool, ID.mine, reader.userId, "The Long Field");
  await project(ID.mine, reader.userId, "1998-07-04T19:30:00.000Z", "public", [
    { type: "location", id: placeId },
  ]);

  occasionId = await createRealWorldEvent(directory.pool, reader.userId, {
    name: "The Eclipse",
    occurrenceStart: "1999-08-11T11:03:00.000Z",
    occurrenceEnd: "1999-08-11T11:05:00.000Z",
  });
  ID.atOccasion = await createMoment(directory.pool, reader.userId, {
    occurredAt: "1999-08-11T11:04:00.000Z",
  });
  await directory.pool.query(
    "INSERT INTO moment_real_world_events (moment_id, real_world_event_id) VALUES ($1, $2)",
    [ID.atOccasion, occasionId],
  );
  await project(ID.atOccasion, reader.userId, "1999-08-11T11:04:00.000Z", "public", [
    { type: "person", id: reader.userId },
    { type: "real_world_event", id: occasionId },
  ]);

  // Significance, so a span has something to be about.
  for (const [momentId, value] of [
    [ID.mine, 90],
    [ID.mineLater, 10],
  ] as const) {
    await directory.pool.query(
      `INSERT INTO moment_significance
         (moment_id, scope_type, scope_id, dimension, value, baseline_value, provenance,
          algorithm_version, computed_at)
       VALUES ($1, 'person', $2, 'temporal', $3, 0, 'rule', 'test-1', now())`,
      [momentId, reader.userId, value],
    );
  }
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

describe("a pointer is not a permission", () => {
  it("answers a Moment that does not exist exactly as one that is not yours", async () => {
    // The deep equality is the assertion. Two different reasons, one answer:
    // anything else would say which applied.
    const missing = await jump({ moment: randomUUID() });
    const hidden = await createMoment(directory.pool, author.userId, {
      occurredAt: "1998-05-05T00:00:00.000Z",
      visibility: "private",
    });
    const refused = await jump({ moment: hidden });

    assert.deepEqual(refused, missing);
    assert.equal(missing.anchoredAt, null);
    assert.equal(missing.at, null);
    assert.deepEqual(missing.older.edges, []);
    assert.deepEqual(missing.newer.edges, []);
  });

  it("refuses an occasion that is not yours as though it were not there", async () => {
    const nobodys = await createRealWorldEvent(directory.pool, author.userId, {
      name: "Something Private",
      occurrenceStart: "1998-02-02T00:00:00.000Z",
      occurrenceEnd: "1998-02-02T01:00:00.000Z",
    });

    assert.deepEqual(
      await jump({ realWorldEvent: { realWorldEventId: nobodys } }),
      await jump({ realWorldEvent: { realWorldEventId: randomUUID() } }),
    );
  });

  it("refuses a place with nothing readable in it as though it were not there", async () => {
    const empty = await createPlace(
      directory.pool,
      await createMoment(directory.pool, author.userId, {
        occurredAt: "1997-01-01T00:00:00.000Z",
        visibility: "private",
      }),
      author.userId,
      "Somewhere Else",
    );

    assert.deepEqual(
      await jump({ location: { locationId: empty } }),
      await jump({ location: { locationId: randomUUID() } }),
    );
  });

  it("refuses a relationship travelled from a Moment it has nothing to do with", async () => {
    // Without the far-end check being tied to the Moment named, holding any
    // relationship identifier would be a way to travel from anywhere.
    const landing = await jump({
      causal: { fromMomentId: ID.mineLater as string, relationshipId },
    });

    assert.equal(landing.anchoredAt, null);
  });

  it("refuses a relationship that does not exist, as it refuses a Moment that does not", async () => {
    // The same answer for every way of naming nothing, so the shape of a
    // refusal never says which kind of nothing it was.
    assert.deepEqual(
      await jump({ causal: { fromMomentId: ID.mine as string, relationshipId: randomUUID() } }),
      await jump({ causal: { fromMomentId: randomUUID(), relationshipId } }),
    );
  });

  it("refuses a span nothing readable falls in", async () => {
    const landing = await jump({
      significance: { startsAt: "1975-01-01T00:00:00.000Z", scale: "YEAR" },
    });

    assert.equal(landing.anchoredAt, null);
    assert.equal(landing.at, null);
  });
});

describe("crossing into another Timeline", () => {
  it("lands where the relationship points, and says whose history that is", async () => {
    const landing = await jump({
      causal: { fromMomentId: ID.mine as string, relationshipId },
    });

    assert.equal(landing.at?.momentId, ID.theirs);
    assert.equal(landing.reason, "CAUSAL_RELATIONSHIP");
    assert.deepEqual(landing.scope, { type: "PERSON", id: author.userId });
  });

  it("brings the destination's own history, not the history it came from", async () => {
    // The proof that the pages were read against the destination rather than
    // against the Timeline the jump started in: what comes back is the author's
    // history and none of the reader's.
    const landing = await jump({
      causal: { fromMomentId: ID.mine as string, relationshipId },
    });
    const returned = [...landing.older.edges, ...landing.newer.edges].map(
      (edge) => edge.node.momentId,
    );

    assert.ok(returned.includes(ID.theirs));
    assert.ok(returned.includes(ID.theirsLater));
    assert.ok(!returned.includes(ID.mine), "the source Timeline's history came back");
    assert.deepEqual(landing.older.scope, landing.scope);
    assert.deepEqual(landing.newer.scope, landing.scope);
  });

  it("resolves the destination Timeline's permission rather than reusing the source's", async () => {
    // The behavioural proof, and the reason it is worth writing. The destination
    // sits on a Timeline its owner has turned off. The reader's own Timeline is
    // open — so reusing the eligibility resolved for the source would read the
    // pages as though the door were open and return history. Asking about the
    // destination's scope is what makes them empty.
    const landing = await jump({
      causal: { fromMomentId: ID.mine as string, relationshipId: shutRelationshipId },
    });

    assert.deepEqual(landing.scope, { type: "PERSON", id: closed.userId });
    assert.deepEqual(landing.older.edges, []);
    assert.deepEqual(landing.newer.edges, []);
    assert.equal(landing.at, null);
    // The position is still real: the Moment was readable, and saying so
    // discloses nothing that opening it directly would not.
    assert.equal(landing.anchoredAt, "1999-04-04T00:00:00.000Z");
  });

  it("stays put when the destination is already in the Timeline being read", async () => {
    const landing = await jump({ moment: ID.mineLater as string });

    assert.equal(landing.at?.momentId, ID.mineLater);
    assert.deepEqual(landing.scope, { type: "PERSON", id: reader.userId });
  });
});

describe("naming a place or an occasion", () => {
  it("opens a place where its history is, and says it is that place", async () => {
    const landing = await jump({ location: { locationId: placeId } });

    assert.deepEqual(landing.scope, { type: "LOCATION", id: placeId });
    assert.equal(landing.reason, "LOCATION");
    assert.equal(landing.at?.momentId, ID.mine);
  });

  it("opens a place at the instant asked for", async () => {
    const landing = await jump({
      location: { locationId: placeId, at: "1998-07-04T19:30:00.000Z" },
    });

    assert.equal(landing.anchoredAt, "1998-07-04T19:30:00.000Z");
    assert.equal(landing.at?.momentId, ID.mine);
  });

  it("lands an occasion at its own recorded start, not at any Moment's", async () => {
    // The one destination carrying an instant of its own. The Moment recorded
    // during it happened a minute later, and the landing is the occasion's.
    const landing = await jump({ realWorldEvent: { realWorldEventId: occasionId } });

    assert.deepEqual(landing.scope, { type: "REAL_WORLD_EVENT", id: occasionId });
    assert.equal(landing.anchoredAt, "1999-08-11T11:03:00.000Z");
    assert.equal(landing.at, null);
    assert.deepEqual(
      landing.newer.edges.map((edge) => edge.node.momentId),
      [ID.atOccasion],
    );
  });
});

describe("jumping to what a span was about", () => {
  it("lands on the Moment temporal zoom already shows for that span", async () => {
    // This equality is the decision, expressed as a test. If the two surfaces
    // ever disagree, one of them is ranking history a way the other is not.
    const view = { scope: { type: "PERSON", id: reader.userId }, range: { fixed: { from: "1998-01-01T00:00:00.000Z", to: "1998-12-31T00:00:00.000Z" } } };
    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      headers: { authorization: `Bearer ${reader.token}` },
      payload: { query: SPAN, variables: { view, scale: "YEAR" } },
    });
    const body = response.json() as {
      data: {
        temporalDistribution: {
          buckets: { startsAt: string; representatives: { momentId: string }[] }[];
        };
      } | null;
      errors?: unknown[];
    };

    assert.equal(body.errors, undefined);

    const bucket = (
      body.data as {
        temporalDistribution: {
          buckets: { startsAt: string; representatives: { momentId: string }[] }[];
        };
      }
    ).temporalDistribution.buckets[0];
    const landing = await jump({
      significance: { startsAt: bucket?.startsAt as string, scale: "YEAR" },
    });

    assert.equal(landing.at?.momentId, bucket?.representatives[0]?.momentId);
    assert.equal(landing.reason, "HISTORICAL_SIGNIFICANCE");
  });

  it("refuses a span that does not begin where a year begins", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      headers: { authorization: `Bearer ${reader.token}` },
      payload: {
        query: AROUND,
        variables: {
          view: { scope: { type: "PERSON", id: reader.userId } },
          anchor: { significance: { startsAt: "1998-06-15T00:00:00.000Z", scale: "YEAR" } },
        },
      },
    });
    const body = response.json() as { errors?: { message: string }[] };

    assert.match(body.errors?.[0]?.message ?? "", /year begins/);
  });
});

describe("naming a destination badly", () => {
  it("refuses a jump naming two destinations", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      headers: { authorization: `Bearer ${reader.token}` },
      payload: {
        query: AROUND,
        variables: {
          view: { scope: { type: "PERSON", id: reader.userId } },
          anchor: { moment: ID.mine, instant: "1998-07-04T19:30:00.000Z" },
        },
      },
    });
    const body = response.json() as { errors?: { message: string }[] };

    assert.match(body.errors?.[0]?.message ?? "", /one destination/);
  });

  it("refuses somebody who offered no credential", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      payload: {
        query: AROUND,
        variables: {
          view: { scope: { type: "PERSON", id: reader.userId } },
          anchor: { instant: "1998-07-04T19:30:00.000Z" },
        },
      },
    });
    const body = response.json() as { errors?: { message: string }[] };

    assert.ok(body.errors !== undefined && body.errors.length > 0);
  });
});
