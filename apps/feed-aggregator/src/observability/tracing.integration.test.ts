import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { encodeCursor, TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
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
  removePeople,
  type Person,
} from "../testing/moment-fixtures.js";

/**
 * Where a request spent its time.
 *
 * An integration test, because what is being proved is that the stages nest —
 * and nesting is a property of the real call path, not of anything a unit test
 * could arrange. A stubbed context would produce whatever tree the stub's shape
 * implied.
 *
 * Two things are settled here.
 *
 * **The tree has the shape `feed.md:1303-1308` names**, with the composition
 * stages beneath the operation rather than beside it. `feed.md:1311` — "avoid
 * one opaque resolver span" — is the assertion: a single span covering the whole
 * request would satisfy "tracing exists" and answer nothing.
 *
 * **Nothing a Viewer supplied reaches a span.** `observability.md:475` forbids
 * raw GraphQL variables, and the failure mode is quiet: telemetry is a second
 * store, usually with looser access control than the database it describes, and
 * a caption or a coordinate that reaches it has left the system that was
 * guarding it.
 *
 * Spans are collected in memory rather than sent to the collector `compose.yaml`
 * runs. What the collector proves is that the wire format is right; what this
 * proves is that the spans are.
 */

const VERSION = `test-${randomUUID().slice(0, 8)}`;
const base = testAppConfig();
const config: AppConfig = {
  ...base,
  clickhouse: { ...base.clickhouse, projectionVersion: VERSION },
};

const spans = new InMemorySpanExporter();
let provider: NodeTracerProvider;

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;
let reader: Person & { token: string };
const people: Person[] = [];

const TIMELINE = `query Timeline($view: TimelineViewInput!, $after: Cursor) {
  timeline(view: $view, first: 5, after: $after) { edges { cursor } }
}`;

/**
 * Ask for a page of the reader's own history.
 *
 * @param after - A cursor to resume from, or undefined to start at the head.
 * @returns The response body.
 */
async function readTimeline(after?: string): Promise<{ errors?: { message: string }[] }> {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${reader.token}` },
    payload: {
      query: TIMELINE,
      variables: {
        view: { scope: { type: "PERSON", id: reader.userId } },
        ...(after === undefined ? {} : { after }),
      },
    },
  });

  return response.json() as { errors?: { message: string }[] };
}

/** Every span name recorded since the last reset. */
const named = (): string[] => spans.getFinishedSpans().map((span) => span.name);

beforeAll(async () => {
  // Registered globally, which is how `trace.getTracer` in `tracing.ts` finds
  // it: the application asks for a tracer by name and takes whatever provider
  // is installed, exactly as it would in production.
  provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] });
  provider.register();

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

  await createMoment(directory.pool, created.userId);
});

beforeEach(() => {
  spans.reset();
});

afterAll(async () => {
  await removePeople(directory.pool, people);
  await app.close();
  await store.close();
  await directory.close();
  await provider.shutdown();
});

describe("saying where a request spent its time", () => {
  it("names each composition stage rather than the request as a whole", async () => {
    await readTimeline();

    const recorded = named();

    for (const stage of [
      "resolve timeline",
      "decode cursor",
      "resolve eligibility (PostgreSQL)",
      "query timeline (ClickHouse)",
      "map GraphQL response",
    ]) {
      assert.ok(recorded.includes(stage), `no span named "${stage}" in ${recorded.join(", ")}`);
    }
  });

  it("nests the stages beneath the operation, which is what makes them comparable", async () => {
    // The assertion `feed.md:1311` is actually asking for. Five sibling spans
    // with no parent would carry the same names and answer nothing about which
    // part of one request was slow.
    await readTimeline();

    const finished = spans.getFinishedSpans();
    const root = finished.find((span) => span.name === "resolve timeline");
    const stage = finished.find((span) => span.name === "query timeline (ClickHouse)");

    assert.ok(root !== undefined && stage !== undefined);
    assert.equal(stage.parentSpanContext?.spanId, root.spanContext().spanId);
    assert.equal(stage.spanContext().traceId, root.spanContext().traceId);
  });

  it("carries dimensions that stay bounded, and no identifier", async () => {
    // `observability.md:410` forbids userId and momentId as dimensions. The
    // scope's *type* is one of three values; its identifier is one per account.
    await readTimeline();

    const read = spans.getFinishedSpans().find((one) => one.name.startsWith("query timeline"));
    const attributes = read?.attributes ?? {};

    assert.equal(attributes["chronologity.scope_type"], "person");
    assert.equal(attributes["chronologity.direction"], "older");
    assert.ok(!Object.values(attributes).includes(reader.userId), "a span carried the Viewer");
  });

  it("puts nothing a client sent into a span", async () => {
    // The cursor is the sharpest case: it is opaque, it is client-supplied, and
    // it is exactly the sort of value that looks harmless enough to attach to
    // the span that decodes it. Built here rather than read back from a page,
    // because what is being proved is that a value a client sent stays out of
    // the spans — and where the client got it changes nothing about that.
    const cursor = encodeCursor({
      occurredAt: new Date("1998-07-04T19:30:00.000Z"),
      momentId: randomUUID(),
    });

    spans.reset();

    const body = await readTimeline(cursor);

    assert.equal(body.errors, undefined, JSON.stringify(body.errors));

    const printed = JSON.stringify(
      spans.getFinishedSpans().map((span) => ({ name: span.name, attributes: span.attributes })),
    );

    assert.ok(!printed.includes(cursor), "a span carried the cursor a client sent");
    assert.ok(!printed.includes(reader.userId), "a span carried the Viewer");
  });

  it("marks the stage that failed, by class rather than by message", async () => {
    // A driver's message can carry a fragment of the statement that failed, and
    // a statement carries identifiers. The class says enough to find it.
    const broken = await buildApp({
      config,
      dependencies: [store, directory],
      graphql: {
        store: {
          ...store,
          client: {
            query: () => {
              throw new Error(`the projection ${VERSION} is unreachable`);
            },
          },
        } as unknown as ReadStore,
        sessions: new SessionRepository(directory.pool),
        eligibility: new TimelineEligibilityResolver(asQueryable(directory.pool)),
        directory: directory.pool,
      },
    });

    spans.reset();
    await broken.inject({
      method: "POST",
      url: "/graphql",
      headers: { authorization: `Bearer ${reader.token}` },
      payload: {
        query: TIMELINE,
        variables: { view: { scope: { type: "PERSON", id: reader.userId } } },
      },
    });
    await broken.close();

    const failed = spans.getFinishedSpans().find((one) => one.status.code === 2);

    assert.ok(failed !== undefined, "no span was marked failed");
    assert.equal(failed.status.message, "Error");
    // Only the parts a span carries off the process. A whole `ReadableSpan`
    // holds a reference back to its own provider and cannot be serialised.
    assert.ok(
      !JSON.stringify({
        name: failed.name,
        attributes: failed.attributes,
        status: failed.status,
      }).includes(VERSION),
      "the span carried the failure's detail",
    );
  });
});
