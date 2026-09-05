import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { GraphQLError } from "graphql";
import type { Pool } from "pg";
import type { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import { SignJWT } from "jose";
import { afterEach, describe, it } from "vitest";
import type { OpenSession, SessionLookup } from "../auth/session.repository.js";
import type { AppConfig } from "../config/app-config.js";
import { createReadStore, type ReadStore } from "../read-models/clickhouse/client.js";
import { testAppConfig } from "../testing/app-config.js";
import { buildApp } from "./app.js";

/**
 * The GraphQL surface, over the wire.
 *
 * These run without infrastructure, and can: the ClickHouse client connects
 * lazily and nothing here asks it a question, while the Session lookup is the
 * one thing stubbed. What is under test is the transport — that a query reaches
 * a resolver with the right Viewer, that a refusal is a refusal, that a document
 * deeper than the limit is rejected, and that a failure nobody planned tells the
 * client nothing about what went wrong.
 *
 * The real stores are exercised in `app.integration.test.ts`.
 */

const IDENTITY = randomUUID();
const SESSION = randomUUID();
const USER = randomUUID();

const open = (identityId = IDENTITY): SessionLookup => ({
  findOpen: async (): Promise<OpenSession> => ({ identityId }),
});

const closed: SessionLookup = { findOpen: async () => undefined };

/**
 * An eligibility resolver nothing in this file reaches.
 *
 * Nothing here reads history: the one test that names a Timeline query is
 * refused while its arguments are being coerced, which is before any resolver
 * runs — and proving that it never gets that far is half of what that test is
 * for. It fails loudly rather than answering, because a test that started
 * needing it should say so rather than quietly pass on an invented answer.
 */
const NEVER_ASKED = {
  resolve: () => {
    throw new Error("a test asked for eligibility without arranging any");
  },
  viewerFacts: () => {
    throw new Error("a test asked about the Viewer without arranging anything");
  },
} as unknown as TimelineEligibilityResolver;

/**
 * A pool nothing in this file reaches.
 *
 * Reading a Moment is the only thing that would, and no test here does — these
 * are about the transport. It fails loudly rather than answering, for the same
 * reason as the resolver above.
 */
const NEVER_READ = {
  query: () => {
    throw new Error("a test read a Moment without arranging any");
  },
} as unknown as Pool;

let app: FastifyInstance | undefined;
let store: ReadStore | undefined;

const appWith = async (
  sessions: SessionLookup,
  overrides: Partial<AppConfig> = {},
): Promise<FastifyInstance> => {
  const config = testAppConfig(overrides);

  store = createReadStore(config.clickhouse);
  app = await buildApp({
    config,
    dependencies: [],
    graphql: { store, sessions, eligibility: NEVER_ASKED, directory: NEVER_READ },
  });

  return app;
};

afterEach(async () => {
  await app?.close();
  await store?.close();
  app = undefined;
  store = undefined;
});

const tokenFor = async (
  config: AppConfig,
  claims: { sub?: string; sid?: string; uid?: string } = {},
): Promise<string> =>
  new SignJWT({ sid: claims.sid ?? SESSION, uid: claims.uid ?? USER })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub ?? IDENTITY)
    .setIssuer(config.auth.issuer)
    .setAudience(config.auth.audience)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(config.auth.jwtSecret);

const ask = async (
  instance: FastifyInstance,
  query: string,
  headers: Record<string, string> = {},
) => instance.inject({ method: "POST", url: "/graphql", headers, payload: { query } });

describe("a query with no credentials", () => {
  it("succeeds, as an anonymous reader", async () => {
    const instance = await appWith(closed);

    const response = await ask(instance, "{ viewer { authenticated userId } }");

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data, {
      viewer: { authenticated: false, userId: null },
    });
  });
});

describe("a query with credentials", () => {
  it("succeeds when the token verifies and the Session is open", async () => {
    const config = testAppConfig();
    const instance = await appWith(open());

    const response = await ask(instance, "{ viewer { authenticated userId } }", {
      authorization: `Bearer ${await tokenFor(config)}`,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data, { viewer: { authenticated: true, userId: USER } });
  });

  it("is refused when the Session has been revoked", async () => {
    // The whole reason the Session is read at all. The token below is
    // cryptographically perfect and must stop working the moment somebody signs
    // out — not when it expires ten minutes later.
    const config = testAppConfig();
    const instance = await appWith(closed);

    const response = await ask(instance, "{ viewer { authenticated } }", {
      authorization: `Bearer ${await tokenFor(config)}`,
    });
    const body = response.json();

    assert.equal(response.statusCode, 401);
    assert.equal(body.data, null);
    assert.equal(body.errors[0].extensions.code, "AUTHENTICATION_FAILED");
  });

  it("is refused when the token was signed by somebody else", async () => {
    const instance = await appWith(open());
    const forged = await new SignJWT({ sid: SESSION, uid: USER })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(IDENTITY)
      .setIssuer("chronologity")
      .setAudience("chronologity-clients")
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode("a-secret-nobody-here-signs-with"));

    const response = await ask(instance, "{ viewer { authenticated } }", {
      authorization: `Bearer ${forged}`,
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().errors[0].extensions.code, "AUTHENTICATION_FAILED");
  });

  it("is refused rather than quietly answered as anonymous", async () => {
    // The distinction the product depends on. A client shown an anonymous
    // Timeline because its token expired would render somebody's history as
    // though it had shrunk.
    const instance = await appWith(closed);

    const response = await ask(instance, "{ viewer { authenticated } }", {
      authorization: "Bearer not-even-a-token",
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().data, null);
  });

  it("says the same thing however it was refused", async () => {
    const config = testAppConfig();
    const instance = await appWith(closed);

    const revoked = await ask(instance, "{ viewer { authenticated } }", {
      authorization: `Bearer ${await tokenFor(config)}`,
    });
    const malformed = await ask(instance, "{ viewer { authenticated } }", {
      authorization: "Bearer not-even-a-token",
    });

    assert.equal(revoked.json().errors[0].message, malformed.json().errors[0].message);
  });

  it("refuses a Session belonging to a different Identity", async () => {
    const config = testAppConfig();
    const instance = await appWith(open(randomUUID()));

    const response = await ask(instance, "{ viewer { authenticated } }", {
      authorization: `Bearer ${await tokenFor(config)}`,
    });

    assert.equal(response.statusCode, 401);
  });
});

describe("query cost", () => {
  it("refuses a document deeper than the limit", async () => {
    const instance = await appWith(closed, { graphql: { maxDepth: 1, maxCost: 10_000, graphiql: false } });

    const response = await ask(instance, "{ viewer { authenticated } }");
    const body = response.json();

    assert.equal(response.statusCode, 400);
    assert.match(body.errors[0].message, /depth/i);
  });

  it("allows a document within the limit", async () => {
    const instance = await appWith(closed, { graphql: { maxDepth: 2, maxCost: 10_000, graphiql: false } });

    const response = await ask(instance, "{ viewer { authenticated } }");

    assert.equal(response.statusCode, 200);
  });
});

describe("what a client is told about a failure", () => {
  it("names an unknown field, because that describes the query rather than the store", async () => {
    const instance = await appWith(closed);

    const response = await ask(instance, "{ viewer { occurredAt } }");
    const body = response.json();

    assert.equal(response.statusCode, 400);
    assert.match(body.errors[0].message, /occurredAt/);
    assert.equal(body.errors[0].extensions.code, "VALIDATION_FAILED");
  });

  it("reports a syntax error rather than swallowing it", async () => {
    const instance = await appWith(closed);

    const response = await ask(instance, "{ viewer {");

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().errors.length, 1);
  });

  it("tells the client nothing about a failure nobody planned", async () => {
    // The default that matters. What fails in a read service is a ClickHouse
    // query, and its message names a table, a column and a projection version.
    const instance = await appWith({
      findOpen: async () => {
        throw new Error('relation "sessions" does not exist on shard 3');
      },
    });
    const config = testAppConfig();

    const response = await ask(instance, "{ viewer { authenticated } }", {
      authorization: `Bearer ${await tokenFor(config)}`,
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.errors[0].message, "An unexpected error occurred");
    assert.equal(body.errors[0].extensions.code, "INTERNAL_ERROR");
    assert.ok(!JSON.stringify(body).includes("shard 3"));
  });

  it("refuses a cursor it did not issue as a refusal rather than an internal error", async () => {
    // The scalar throws while the argument is coerced, so GraphQL wraps the
    // refusal in an error of its own. Unrecognised, that wrapper would reach the
    // client as "An unexpected error occurred", which `feed.md:562` forbids and
    // which a client cannot tell from the service falling over.
    const instance = await appWith(open());
    const config = testAppConfig();

    const response = await ask(
      instance,
      `{ timeline(view: { scope: { type: PERSON, id: "${USER}" } }, after: "forged") {
           pageInfo { hasNextPage }
         } }`,
      { authorization: `Bearer ${await tokenFor(config)}` },
    );
    const body = response.json();

    assert.equal(body.errors[0].extensions.code, "VALIDATION_FAILED");
    assert.ok(!JSON.stringify(body).includes("base64"));
  });

  it("does not let an error invent a classification of its own", async () => {
    // Only codes this system defines are honoured. A library that happened to
    // put something in `extensions.code` would otherwise choose how it is
    // presented, and its message would travel with it.
    const instance = await appWith({
      findOpen: async () => {
        throw new GraphQLError("relation \"sessions\" does not exist", {
          extensions: { code: "CLICKHOUSE_TABLE_MISSING" },
        });
      },
    });
    const config = testAppConfig();

    const response = await ask(instance, "{ viewer { authenticated } }", {
      authorization: `Bearer ${await tokenFor(config)}`,
    });
    const body = response.json();

    assert.equal(body.errors[0].extensions.code, "INTERNAL_ERROR");
    assert.equal(body.errors[0].message, "An unexpected error occurred");
  });

  it("quotes a trace identifier a report can be found by", async () => {
    const instance = await appWith(closed);

    const response = await ask(instance, "{ viewer { occurredAt } }", {
      "x-trace-id": "carried-from-the-client",
    });

    assert.equal(response.json().errors[0].extensions.traceId, "carried-from-the-client");
  });
});

describe("the read contract", () => {
  it("exposes no mutations", async () => {
    const instance = await appWith(closed);

    const response = await ask(instance, "{ __schema { mutationType { name } } }");

    assert.equal(response.json().data.__schema.mutationType, null);
  });

  it("exposes no subscriptions", async () => {
    const instance = await appWith(closed);

    const response = await ask(instance, "{ __schema { subscriptionType { name } } }");

    assert.equal(response.json().data.__schema.subscriptionType, null);
  });
});

describe("mounting GraphQL", () => {
  it("leaves the rest of the application answering in the shared envelope", async () => {
    // Mercurius calls setErrorHandler when it loads, and it is a
    // fastify-plugin — so registering it at the root would replace this
    // application's handler everywhere, and an unknown path would start
    // answering in the GraphQL error format. This is what proves the scope.
    const instance = await appWith(closed);

    const response = await instance.inject({ method: "GET", url: "/timeline" });
    const body = response.json();

    assert.equal(response.statusCode, 404);
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(body.errors, undefined);
  });

  it("leaves health checks answering without a Viewer", async () => {
    // The authentication hook lives in the GraphQL scope for this reason: a
    // client with a stale credential must not be able to make an instance look
    // unready.
    const instance = await appWith(closed);

    const response = await instance.inject({
      method: "GET",
      url: "/health/live",
      headers: { authorization: "Bearer not-even-a-token" },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  });
});
