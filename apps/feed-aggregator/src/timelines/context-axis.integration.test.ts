import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asClickHouseDateTime, TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
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

/**
 * Moving sideways, through the contract a client actually speaks.
 *
 * Two things are proved here that the read model's own suite cannot. The axis is
 * **continuous** — an anchor sharing history with nothing still has somewhere to
 * go, which is the property this phase was rebuilt around. And a place is named
 * only when some Moment tying it here disclosed where it happened, which needs
 * both stores to agree and so cannot be seen from either alone.
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
const people: Person[] = [];

const AXIS = `query Axis($scope: TimelineScopeInput!, $at: DateTime!, $first: Int, $after: Cursor) {
  adjacentContexts(scope: $scope, at: $at, first: $first, after: $after) {
    edges { cursor node { scope { type id } name adjacency } }
    pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
  }
}`;

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
 * Put a Moment into the contexts it belongs to.
 *
 * @param momentId - Which Moment.
 * @param authorUserId - Whose it is.
 * @param occurredAt - When it happened.
 * @param contexts - Every context it belongs to.
 * @returns Nothing.
 */
async function project(
  momentId: string,
  authorUserId: string,
  occurredAt: string,
  contexts: readonly { type: string; id: string }[],
): Promise<void> {
  await store.client.insert({
    table: "timeline_moment_contexts",
    values: contexts.map((context) => ({
      context_type: context.type,
      context_id: context.id,
      occurred_at: asClickHouseDateTime(new Date(occurredAt)),
      moment_id: momentId,
      author_user_id: authorUserId,
      visibility: "public",
      moderation_state: "allowed",
      projected_at: asClickHouseDateTime(new Date()),
      projection_version: VERSION,
    })),
    format: "JSONEachRow",
  });
}

/** Ask what is beside a context. */
async function axis(
  scope: { type: string; id: string },
  token: string,
  over: { at?: string; first?: number; after?: string } = {},
): Promise<{
  edges: { cursor: string; node: { scope: { type: string; id: string }; name: string; adjacency: string } }[];
  pageInfo: Record<string, unknown>;
  errors?: { extensions?: { code?: string } }[];
}> {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      query: AXIS,
      variables: {
        scope,
        at: over.at ?? "2026-01-01T00:00:00.000Z",
        first: over.first ?? 20,
        after: over.after ?? null,
      },
    },
  });
  const body = response.json();

  return { ...(body.data?.adjacentContexts ?? { edges: [], pageInfo: {} }), errors: body.errors };
}

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
});

afterAll(async () => {
  await removePeople(directory.pool, people);
  await store.client.command({
    query: `DELETE FROM timeline_moment_contexts WHERE projection_version = {version: String}`,
    query_params: { version: VERSION },
    clickhouse_settings: { lightweight_deletes_sync: "0" },
  });
  await app.close();
  await store.close();
  await directory.close();
});

describe("standing somewhere and looking sideways", () => {
  it("reaches an occasion its history shares, and says why", async () => {
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);
    const locationId = await createPlace(directory.pool, momentId, author.userId);
    const occasion = await createRealWorldEvent(directory.pool, author.userId, {
      name: "Anime NYC 2026",
    });

    await attachToEvent(directory.pool, momentId, occasion);
    await project(momentId, author.userId, "2025-06-01T00:00:00Z", [
      { type: "location", id: locationId },
      { type: "real_world_event", id: occasion },
    ]);

    const found = await axis({ type: "LOCATION", id: locationId }, author.token);

    assert.equal(found.errors, undefined, JSON.stringify(found.errors));
    assert.deepEqual(
      found.edges.map((edge) => ({ name: edge.node.name, why: edge.node.adjacency })),
      [{ name: "Anime NYC 2026", why: "SHARED_HISTORY" }],
    );
    assert.deepEqual(found.edges[0]?.node.scope, { type: "REAL_WORLD_EVENT", id: occasion });
  });

  it("keeps going when nothing shares its history", async () => {
    // The property this phase was rebuilt around. A place connected to nothing
    // still has somewhere to scroll to.
    const author = await signedInPerson();
    const lonely = await createMoment(directory.pool, author.userId);
    const lonelyPlace = await createPlace(directory.pool, lonely, author.userId);
    const other = await createMoment(directory.pool, author.userId);
    const otherPlace = await createPlace(directory.pool, other, author.userId);

    await project(lonely, author.userId, "2025-06-01T00:00:00Z", [
      { type: "location", id: lonelyPlace },
    ]);
    await project(other, author.userId, "2025-05-01T00:00:00Z", [
      { type: "location", id: otherPlace },
    ]);

    const found = await axis({ type: "LOCATION", id: lonelyPlace }, author.token);

    assert.ok(found.edges.length > 0, "an anchor sharing no history had nowhere to go");
    assert.ok(found.edges.every((edge) => edge.node.adjacency === "SAME_PERIOD"));
  });

  it("puts shared history before the rest", async () => {
    const author = await signedInPerson();
    const anchorMoment = await createMoment(directory.pool, author.userId);
    const anchorPlace = await createPlace(directory.pool, anchorMoment, author.userId);
    const occasion = await createRealWorldEvent(directory.pool, author.userId, { name: "Shared" });
    const unrelated = await createMoment(directory.pool, author.userId);
    const unrelatedPlace = await createPlace(directory.pool, unrelated, author.userId);

    await attachToEvent(directory.pool, anchorMoment, occasion);
    await project(anchorMoment, author.userId, "2025-06-01T00:00:00Z", [
      { type: "location", id: anchorPlace },
      { type: "real_world_event", id: occasion },
    ]);
    // Deliberately more recent, so ordering by time alone would put it first.
    await project(unrelated, author.userId, "2025-12-01T00:00:00Z", [
      { type: "location", id: unrelatedPlace },
    ]);

    const found = await axis({ type: "LOCATION", id: anchorPlace }, author.token);

    assert.equal(found.edges[0]?.node.adjacency, "SHARED_HISTORY");
    assert.equal(found.edges[0]?.node.scope.id, occasion);
  });

  it("refuses to look sideways from a person", async () => {
    const reader = await signedInPerson();

    const found = await axis({ type: "PERSON", id: reader.userId }, reader.token);

    assert.equal(found.errors?.[0]?.extensions?.code, "VALIDATION_FAILED");
  });
});

describe("naming a place only when a Moment disclosed it", () => {
  it("leaves out a place every supporting Moment hid", async () => {
    // The leak this gate exists for: the Moment is readable, so the edge is
    // well-formed — but naming the place would say where it happened.
    const author = await signedInPerson();
    const reader = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId, {
      locationDisclosure: "hidden",
    });
    const secret = await createPlace(directory.pool, momentId, author.userId, "Their flat");
    const occasion = await createRealWorldEvent(directory.pool, author.userId);

    await attachToEvent(directory.pool, momentId, occasion);
    await project(momentId, author.userId, "2025-06-01T00:00:00Z", [
      { type: "location", id: secret },
      { type: "real_world_event", id: occasion },
    ]);

    const found = await axis({ type: "REAL_WORLD_EVENT", id: occasion }, reader.token);

    assert.ok(!found.edges.some((edge) => edge.node.scope.id === secret));
    assert.ok(!JSON.stringify(found).includes("Their flat"));
  });

  it("includes it when a Moment disclosed it exactly", async () => {
    const author = await signedInPerson();
    const reader = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);
    const shown = await createPlace(directory.pool, momentId, author.userId);
    const occasion = await createRealWorldEvent(directory.pool, author.userId);

    await attachToEvent(directory.pool, momentId, occasion);
    await project(momentId, author.userId, "2025-06-01T00:00:00Z", [
      { type: "location", id: shown },
      { type: "real_world_event", id: occasion },
    ]);

    const found = await axis({ type: "REAL_WORLD_EVENT", id: occasion }, reader.token);

    assert.ok(found.edges.some((edge) => edge.node.scope.id === shown));
  });

  it("still gives an author their own hidden place", async () => {
    // A choice about what to tell other people was never a choice to forget it.
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId, {
      locationDisclosure: "hidden",
    });
    const own = await createPlace(directory.pool, momentId, author.userId);
    const occasion = await createRealWorldEvent(directory.pool, author.userId);

    await attachToEvent(directory.pool, momentId, occasion);
    await project(momentId, author.userId, "2025-06-01T00:00:00Z", [
      { type: "location", id: own },
      { type: "real_world_event", id: occasion },
    ]);

    const found = await axis({ type: "REAL_WORLD_EVENT", id: occasion }, author.token);

    assert.ok(found.edges.some((edge) => edge.node.scope.id === own));
  });
});

describe("paging the axis", () => {
  it("resumes where it left off, without repeating or skipping", async () => {
    const author = await signedInPerson();
    const anchorMoment = await createMoment(directory.pool, author.userId);
    const anchorPlace = await createPlace(directory.pool, anchorMoment, author.userId);
    const reached: string[] = [];

    for (let index = 0; index < 4; index += 1) {
      const other = await createMoment(directory.pool, author.userId);
      const otherPlace = await createPlace(directory.pool, other, author.userId);

      await project(other, author.userId, `2024-0${index + 1}-01T00:00:00Z`, [
        { type: "location", id: otherPlace },
      ]);
    }

    await project(anchorMoment, author.userId, "2025-06-01T00:00:00Z", [
      { type: "location", id: anchorPlace },
    ]);

    let after: string | undefined;

    for (let page = 0; page < 4; page += 1) {
      const found = await axis({ type: "LOCATION", id: anchorPlace }, author.token, {
        first: 2,
        ...(after === undefined ? {} : { after }),
      });

      if (found.edges.length === 0) {
        break;
      }

      reached.push(...found.edges.map((edge) => edge.node.scope.id));
      after = found.pageInfo["endCursor"] as string;

      if (found.pageInfo["hasNextPage"] !== true) {
        break;
      }
    }

    assert.ok(reached.length >= 4, `only reached ${reached.length} contexts`);
    assert.equal(new Set(reached).size, reached.length, "a context appeared on two pages");
  });

  it("says there is something behind a page reached from a cursor", async () => {
    const author = await signedInPerson();
    const anchorMoment = await createMoment(directory.pool, author.userId);
    const anchorPlace = await createPlace(directory.pool, anchorMoment, author.userId);

    for (let index = 0; index < 3; index += 1) {
      const other = await createMoment(directory.pool, author.userId);
      const otherPlace = await createPlace(directory.pool, other, author.userId);

      await project(other, author.userId, `2023-0${index + 1}-01T00:00:00Z`, [
        { type: "location", id: otherPlace },
      ]);
    }

    await project(anchorMoment, author.userId, "2025-06-01T00:00:00Z", [
      { type: "location", id: anchorPlace },
    ]);

    const first = await axis({ type: "LOCATION", id: anchorPlace }, author.token, { first: 1 });
    const second = await axis({ type: "LOCATION", id: anchorPlace }, author.token, {
      first: 1,
      after: first.pageInfo["endCursor"] as string,
    });

    assert.equal(first.pageInfo["hasPreviousPage"], false);
    assert.equal(second.pageInfo["hasPreviousPage"], true);
  });

  it("refuses a cursor from another connection", async () => {
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);
    const anchorPlace = await createPlace(directory.pool, momentId, author.userId);

    const found = await axis({ type: "LOCATION", id: anchorPlace }, author.token, {
      after: "not-a-cursor",
    });

    assert.equal(found.errors?.[0]?.extensions?.code, "VALIDATION_FAILED");
  });
});
