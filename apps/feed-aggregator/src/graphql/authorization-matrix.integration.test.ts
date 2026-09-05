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
  removePeople,
  type Person,
} from "../testing/moment-fixtures.js";
import { buildSchema, parse, validate } from "graphql";
import { loadSchema } from "./load-schema.js";
import { fieldsSelectedBy, reachableFields } from "../testing/schema-coverage.js";

/**
 * Who may see what, across every surface — and, more importantly, what nobody
 * has checked.
 *
 * `testing.md:696-711` names the Viewer states a feed authorization matrix must
 * cover, and almost every one of them is already proven somewhere in this
 * application: sixteen suites cover blocks, private Moments, shut Timelines,
 * suspension, age restriction, moderation, withheld entries and indistinguishable
 * refusals. **Re-proving those here would be motion.**
 *
 * So this suite does the thing none of them can. It asks what is *not* covered,
 * the way `apps/api`'s permission matrix does: enumerate the surface, and refuse
 * to let a field be neither exercised nor deliberately exempted. A GraphQL field
 * is reachable the moment it is declared — there is no registration step
 * somebody could forget — which makes an unwatched field easier to add here than
 * in a REST service, not harder.
 *
 * The behavioural cases it does run are the gaps the read-model suites left:
 * **`temporalDistribution`, `adjacentContexts` and `realWorldEvent` under a
 * Block, through the wire.** Each is proven at the read-model layer and none was
 * proven at the contract layer, which is where a resolver that forgot to pass
 * the Viewer would show up.
 */

const VERSION = `matrix-${randomUUID().slice(0, 8)}`;
const base = testAppConfig();
const config: AppConfig = {
  ...base,
  clickhouse: { ...base.clickhouse, projectionVersion: VERSION },
};

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;

let owner: Person & { token: string };
let stranger: Person & { token: string };
let blocked: Person & { token: string };

const people: Person[] = [];
let placeId = "";
let occasionId = "";
let momentId = "";

const AT = "1998-07-04T19:30:00.000Z";

/**
 * The documents the matrix drives, and together the surface it claims to cover.
 *
 * Coverage is read out of these rather than declared beside them, so adding a
 * field to one of these documents is what makes the field covered — and deleting
 * the selection is what makes it uncovered again.
 */
const SURFACES: Readonly<Record<string, string>> = {
  viewer: `{ viewer { authenticated userId } }`,

  timeline: `query T($view: TimelineViewInput!) {
    timeline(view: $view, first: 5) {
      scope { type id }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges { cursor node {
        ... on ReadableTimelineEntry { momentId occurredAt occurrenceEnd occurrencePrecision occurrenceOffsetMinutes visibility discoverable }
        ... on WithheldTimelineEntry { momentId occurredAt occurrenceEnd occurrencePrecision }
      } }
    }
  }`,

  timelineHead: `query H($view: TimelineViewInput!) {
    timelineHead(view: $view) { ... on ReadableTimelineEntry { momentId } }
  }`,

  moment: `query M($id: ID!) {
    moment(id: $id) {
      momentId caption createdAt visibility commentPolicy occurrenceOffsetMinutes
      occurrence { start end precision }
      author { userId handle displayName biography createdAt }
      place { disclosure area { neighbourhood city region country countryCode } location { locationId name precision coordinates { latitude longitude } context { neighbourhood city region country countryCode } } }
      personalSignificance { momentId significant markedAt }
      media(first: 5) { edges { cursor node {
        ... on Image { mediaId width height derivatives }
        ... on Video { mediaId width height derivatives durationSeconds }
      } } pageInfo { hasNextPage } }
      comments(first: 5) { total edges { cursor node {
        commentId momentId body createdAt editedAt deleted threadCommentId inReplyToCommentId
        author { userId handle }
        reactions { enabled total yours counts { kind count } }
        mentions { userId handle }
      } } pageInfo { hasNextPage } }
      reactions { enabled total yours counts { kind count } }
      relationships { relationshipId kind origin unavailable sourceMomentId targetMomentId assertedByUserId createdAt }
    }
  }`,

  timelineAround: `query A($view: TimelineViewInput!, $anchor: TimelineAnchorInput!) {
    timelineAround(view: $view, anchor: $anchor, first: 5) {
      anchoredAt reason
      scope { type id }
      at { ... on ReadableTimelineEntry { momentId } }
      older { edges { cursor } }
      newer { edges { cursor } }
    }
  }`,

  temporalDistribution: `query D($view: TimelineViewInput!, $scale: TimelineScale!) {
    temporalDistribution(view: $view, scale: $scale) {
      scale from to
      scope { type id }
      buckets { startsAt count representatives { momentId } }
    }
  }`,

  adjacentContexts: `query C($scope: TimelineScopeInput!, $at: DateTime!) {
    adjacentContexts(scope: $scope, at: $at, first: 5) {
      pageInfo { hasNextPage }
      edges { cursor node { name adjacency scope { type id } } }
    }
  }`,

  realWorldEvent: `query E($id: ID!) {
    realWorldEvent(id: $id) {
      realWorldEventId name aliases
      occurrence { start end precision }
      locations { locationId name }
    }
  }`,
};

/**
 * Fields nothing drives, each with the reason and where the rule lives.
 *
 * **An exemption is a decision somebody recorded, not a gap somebody left.**
 * That distinction is the only thing separating this from a list that grows
 * whenever a field is inconvenient to cover.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  "Query.timelineHead": "driven, but its union arm is covered by `timeline` above",
};

/**
 * Record a Moment in the projection.
 *
 * @param id - Which Moment.
 * @param authorUserId - Who recorded it.
 * @param scopes - The contexts carrying it.
 * @returns Nothing.
 */
async function project(
  id: string,
  authorUserId: string,
  scopes: { type: string; id: string }[],
): Promise<void> {
  const row: TimelineRow = {
    momentId: id,
    authorUserId,
    occurredAt: new Date(AT),
    recordedAt: new Date(),
    occurrenceEnd: new Date(AT),
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
    values: scopes.map((scope) => ({
      context_type: scope.type,
      context_id: scope.id,
      occurred_at: asClickHouseDateTime(row.occurredAt),
      moment_id: id,
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
 * Somebody signed in.
 *
 * @returns The person and a credential.
 */
async function signedIn(): Promise<Person & { token: string }> {
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
 * Drive one surface as one Viewer.
 *
 * @param surface - Which document.
 * @param token - Whose credential, or undefined for nobody.
 * @param variables - What the document needs.
 * @returns The response body.
 */
async function drive(
  surface: keyof typeof SURFACES,
  token: string | undefined,
  variables: Record<string, unknown> = {},
): Promise<{ data: Record<string, unknown> | null; errors?: { extensions?: { code?: string } }[] }> {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    payload: { query: SURFACES[surface], variables },
  });

  return response.json() as {
    data: Record<string, unknown> | null;
    errors?: { extensions?: { code?: string } }[];
  };
}

const ownerView = () => ({ view: { scope: { type: "PERSON", id: owner.userId } } });

beforeAll(async () => {
  store = createReadStore(config.clickhouse);
  directory = createDirectory(config.database);

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

  owner = await signedIn();
  stranger = await signedIn();
  blocked = await signedIn();

  await directory.pool.query(
    `INSERT INTO user_blocks (blocker_user_id, blocked_user_id, created_at)
     VALUES ($1, $2, now())`,
    [owner.userId, blocked.userId],
  );

  momentId = await createMoment(directory.pool, owner.userId, { occurredAt: AT });
  placeId = await createPlace(directory.pool, momentId, owner.userId, "the long field");
  occasionId = await createRealWorldEvent(directory.pool, owner.userId, {
    name: "the summer it did not rain",
    occurrenceStart: AT,
    occurrenceEnd: "1998-08-31T00:00:00.000Z",
  });
  await attachToEvent(directory.pool, momentId, occasionId);

  await project(momentId, owner.userId, [
    { type: "person", id: owner.userId },
    { type: "location", id: placeId },
    { type: "real_world_event", id: occasionId },
  ]);
});

afterAll(async () => {
  await removePeople(directory.pool, people);
  await app.close();
  await store.close();
  await directory.close();
});

describe("a blocked reader, through every surface", () => {
  it("sees nothing of a place's history", async () => {
    // Proven at the read-model layer and never at this one. A resolver that
    // forgot to pass the Viewer would pass every existing suite.
    const body = await drive("timeline", blocked.token, {
      view: { scope: { type: "LOCATION", id: placeId } },
    });
    const timeline = body.data?.["timeline"] as { edges: unknown[] };

    assert.deepEqual(timeline.edges, []);
  });

  it("is counted out of a temporal distribution", async () => {
    // Counts are a leak channel `authorization.md:293` names explicitly, and a
    // count is the easiest thing to answer without asking who is asking.
    const asOwner = await drive("temporalDistribution", owner.token, {
      view: {
        scope: { type: "LOCATION", id: placeId },
        range: { fixed: { from: "1998-01-01T00:00:00Z", to: "1999-01-01T00:00:00Z" } },
      },
      scale: "YEAR",
    });
    const asBlocked = await drive("temporalDistribution", blocked.token, {
      view: {
        scope: { type: "LOCATION", id: placeId },
        range: { fixed: { from: "1998-01-01T00:00:00Z", to: "1999-01-01T00:00:00Z" } },
      },
      scale: "YEAR",
    });

    const buckets = (body: typeof asOwner) =>
      (body.data?.["temporalDistribution"] as { buckets: { count: number }[] }).buckets;

    assert.ok(buckets(asOwner).length > 0, "the owner saw nothing, so this proves nothing");
    assert.deepEqual(buckets(asBlocked), []);
  });

  it("finds no edge on the horizontal axis", async () => {
    // Adjacency is another named leak channel: an edge exists only through
    // history the reader may see.
    const body = await drive("adjacentContexts", blocked.token, {
      scope: { type: "LOCATION", id: placeId },
      at: AT,
    });
    const contexts = body.data?.["adjacentContexts"] as { edges: unknown[] };

    assert.deepEqual(contexts.edges, []);
  });

  it("cannot learn that an occasion exists", async () => {
    // An occasion is exactly as private as the history establishing it, so a
    // reader who may see none of that history must not be told it happened.
    const asOwner = await drive("realWorldEvent", owner.token, { id: occasionId });
    const asBlocked = await drive("realWorldEvent", blocked.token, { id: occasionId });

    assert.notEqual(asOwner.data?.["realWorldEvent"], null);
    assert.equal(asBlocked.data?.["realWorldEvent"], null);
  });

  it("lands nowhere when jumping into history they may not see", async () => {
    const body = await drive("timelineAround", blocked.token, {
      view: { scope: { type: "LOCATION", id: placeId } },
      anchor: { moment: momentId },
    });
    const landing = body.data?.["timelineAround"] as { at: unknown; anchoredAt: unknown };

    assert.equal(landing.at, null);
    assert.equal(landing.anchoredAt, null);
  });
});

describe("a signed-in reader who is nobody in particular", () => {
  it("sees the public history a blocked reader cannot", async () => {
    // The control the blocked cases need. Every refusal above would also pass
    // if this history were invisible to everybody — a broken fixture, a wrong
    // projection version, a scope nobody may open — and this is what separates
    // "the Block worked" from "nothing was there".
    const body = await drive("timeline", stranger.token, {
      view: { scope: { type: "LOCATION", id: placeId } },
    });
    const timeline = body.data?.["timeline"] as { edges: { node: { momentId?: string } }[] };

    assert.deepEqual(
      timeline.edges.map((edge) => edge.node.momentId),
      [momentId],
    );
  });

  it("is told an occasion exists, where a blocked reader is not", async () => {
    const body = await drive("realWorldEvent", stranger.token, { id: occasionId });

    assert.notEqual(body.data?.["realWorldEvent"], null);
  });
});

describe("a reader with no account", () => {
  it("is refused history rather than shown less of it", async () => {
    // Reading history requires an account (ADR-139). Answering an anonymous
    // request with an empty Timeline would render somebody's history as though
    // it had shrunk.
    const body = await drive("timeline", undefined, ownerView());

    assert.equal(body.errors?.[0]?.extensions?.code, "AUTHENTICATION_FAILED");
  });
});

describe("the owner", () => {
  it("reads their own history through every surface that takes a view", async () => {
    // The control. Without it every refusal above could be a broken fixture.
    for (const surface of ["timeline", "timelineHead"] as const) {
      const body = await drive(surface, owner.token, ownerView());

      assert.equal(body.errors, undefined, `${surface}: ${JSON.stringify(body.errors)}`);
    }

    const moment = await drive("moment", owner.token, { id: momentId });

    assert.equal(moment.errors, undefined, JSON.stringify(moment.errors));
    assert.equal((moment.data?.["moment"] as { momentId: string }).momentId, momentId);
  });
});

describe("what nobody has checked", () => {
  it("drives every field the schema exposes, or records why not", async () => {
    // The assertion this suite exists for, and the only one that can fail
    // because of something somebody *added* rather than something they broke.
    // A field reachable through the schema and named nowhere here is a field
    // whose behaviour under a Block nobody has ever asked about.
    const driven = new Set<string>();

    for (const document of Object.values(SURFACES)) {
      for (const path of fieldsSelectedBy(document)) {
        driven.add(path);
      }
    }

    const uncovered = reachableFields()
      .map((one) => one.path)
      .filter((path) => !driven.has(path) && EXEMPT[path] === undefined);

    assert.deepEqual(
      uncovered,
      [],
      `these fields are exercised by nothing and exempted by nothing:\n  ${uncovered.join("\n  ")}`,
    );
  });

  it("drives documents the schema actually accepts", async () => {
    // The trap `apps/api`'s permission matrix records: "a matrix built on
    // invalid requests would be asserting nothing about authorization at all."
    // Coverage is read by parsing, and parsing accepts a document validation
    // would refuse — so a typo in a selection would silently claim a field was
    // covered by a request that never ran.
    const schema = buildSchema(loadSchema());

    for (const [name, document] of Object.entries(SURFACES)) {
      const problems = validate(schema, parse(document));

      assert.deepEqual(
        problems.map((one) => one.message),
        [],
        `the ${name} document is not valid against the schema`,
      );
    }
  });

  it("keeps every exemption pointing at something real", async () => {
    // An exemption for a field that no longer exists is a decision about
    // nothing, and reads as coverage.
    const reachable = new Set(reachableFields().map((one) => one.path));
    const stale = Object.keys(EXEMPT).filter((path) => !reachable.has(path));

    assert.deepEqual(stale, [], `exemptions for fields that no longer exist: ${stale.join(", ")}`);
  });
});
