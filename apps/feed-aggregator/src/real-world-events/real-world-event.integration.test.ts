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
 * Opening an occurrence in the world.
 *
 * The rule under test has no column behind it: an occurrence is visible exactly
 * when the reader can see a Moment that was part of it. That makes an
 * occurrence's existence as private as the history establishing it — which is
 * what `real-world-events.md:732` asks for, since an Event's existence can
 * itself be sensitive.
 */

const config = testAppConfig();

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;
const people: Person[] = [];

const EVENT = `query Occasion($id: ID!) {
  realWorldEvent(id: $id) {
    realWorldEventId
    name
    aliases
    occurrence { start end precision }
    locations { locationId name precision context { city country } }
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
 * Ask for an occurrence.
 *
 * @param id - Which one.
 * @param token - The credential.
 * @returns The parsed body.
 */
async function ask(
  id: string,
  token: string,
): Promise<{
  data: Record<string, unknown> | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}> {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${token}` },
    payload: { query: EVENT, variables: { id } },
  });

  return response.json();
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
  await app.close();
  await store.close();
  await directory.close();
});

describe("whether an occurrence may be known at all", () => {
  it("answers when a readable Moment was part of it", async () => {
    const author = await signedInPerson();
    const reader = await signedInPerson();
    const realWorldEventId = await createRealWorldEvent(directory.pool, author.userId, {
      name: "Anime NYC 2026",
      aliases: ["ANYC", "Anime New York"],
    });
    const momentId = await createMoment(directory.pool, author.userId);

    await attachToEvent(directory.pool, momentId, realWorldEventId);

    const body = await ask(realWorldEventId, reader.token);
    const occasion = body.data?.["realWorldEvent"] as Record<string, unknown>;

    assert.equal(body.errors, undefined, JSON.stringify(body.errors));
    assert.equal(occasion["name"], "Anime NYC 2026");
    assert.deepEqual(occasion["aliases"], ["ANYC", "Anime New York"]);
    assert.deepEqual(occasion["occurrence"], {
      start: "2026-11-20T00:00:00.000Z",
      end: "2026-11-22T23:59:59.000Z",
      precision: "DAY",
    });
  });

  it("answers nothing, with no error, when none of its history is readable", async () => {
    // The shape of the refusal must say nothing about which reason applied.
    const author = await signedInPerson();
    const stranger = await signedInPerson();
    const realWorldEventId = await createRealWorldEvent(directory.pool, author.userId);
    const momentId = await createMoment(directory.pool, author.userId, { visibility: "private" });

    await attachToEvent(directory.pool, momentId, realWorldEventId);

    const body = await ask(realWorldEventId, stranger.token);

    assert.equal(body.data?.["realWorldEvent"], null);
    assert.equal(body.errors, undefined);
  });

  it("answers the same way for one that never existed", async () => {
    const reader = await signedInPerson();

    const body = await ask(randomUUID(), reader.token);

    assert.equal(body.data?.["realWorldEvent"], null);
    assert.equal(body.errors, undefined);
  });

  it("answers the author of that private history", async () => {
    const author = await signedInPerson();
    const realWorldEventId = await createRealWorldEvent(directory.pool, author.userId);
    const momentId = await createMoment(directory.pool, author.userId, { visibility: "private" });

    await attachToEvent(directory.pool, momentId, realWorldEventId);

    const body = await ask(realWorldEventId, author.token);

    assert.notEqual(body.data?.["realWorldEvent"], null);
  });

  it("answers whoever recorded one no Moment points at", async () => {
    // Provenance granting what provenance should: you may read the record you
    // caused to exist.
    const creator = await signedInPerson();
    const realWorldEventId = await createRealWorldEvent(directory.pool, creator.userId);

    const body = await ask(realWorldEventId, creator.token);

    assert.notEqual(body.data?.["realWorldEvent"], null);
  });

  it("refuses that same one to everybody else", async () => {
    // What keeps the creator exemption from degrading into "anybody may read
    // anything" the moment somebody simplifies the rule.
    const creator = await signedInPerson();
    const stranger = await signedInPerson();
    const realWorldEventId = await createRealWorldEvent(directory.pool, creator.userId);

    const body = await ask(realWorldEventId, stranger.token);

    assert.equal(body.data?.["realWorldEvent"], null);
  });

  it("refuses an identifier that is not one, as a refusal", async () => {
    const reader = await signedInPerson();

    const body = await ask("an-occasion-please", reader.token);

    assert.equal(body.errors?.[0]?.extensions?.code, "VALIDATION_FAILED");
  });
});

describe("what an occurrence carries", () => {
  it("returns its own recorded places in full", async () => {
    // The Event's declaration of where it happened, not derived from where
    // anybody's Moments were.
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);
    const locationId = await createPlace(directory.pool, momentId, author.userId);
    const realWorldEventId = await createRealWorldEvent(directory.pool, author.userId, {
      locationIds: [locationId],
    });

    await attachToEvent(directory.pool, momentId, realWorldEventId);

    const body = await ask(realWorldEventId, author.token);
    const places = (body.data?.["realWorldEvent"] as Record<string, unknown>)["locations"] as {
      locationId: string;
      name: string;
      precision: string;
      context: { city: string };
    }[];

    assert.equal(places.length, 1);
    assert.equal(places[0]?.locationId, locationId);
    assert.equal(places[0]?.name, "Madison Square Garden");
    assert.equal(places[0]?.precision, "EXACT");
    assert.equal(places[0]?.context.city, "New York");
  });

  it("says it goes by no other name rather than saying nothing", async () => {
    const author = await signedInPerson();
    const realWorldEventId = await createRealWorldEvent(directory.pool, author.userId);

    const body = await ask(realWorldEventId, author.token);
    const occasion = body.data?.["realWorldEvent"] as Record<string, unknown>;

    assert.deepEqual(occasion["aliases"], []);
    assert.deepEqual(occasion["locations"], []);
  });

  it("says nothing about who recorded it", async () => {
    const author = await signedInPerson();
    const realWorldEventId = await createRealWorldEvent(directory.pool, author.userId);

    const body = await ask(realWorldEventId, author.token);

    assert.ok(!JSON.stringify(body).includes(author.userId));
  });
});
