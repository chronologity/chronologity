import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { AppConfig } from "../config/app-config.js";
import { NotFoundError } from "../lib/errors/not-found-error.js";
import { UnauthorizedError } from "../lib/errors/unauthorized-error.js";
import type { HealthCheckable } from "../lib/health.js";
import { buildApp } from "./app.js";

const config: AppConfig = {
  nodeEnv: "test",
  logLevel: "fatal",
  host: "127.0.0.1",
  port: 0,
  database: {
    host: "unused",
    port: 5432,
    database: "unused",
    user: "unused",
    password: "unused",
  },
  eventStore: { connectionString: "esdb://unused:2113?tls=false" },
  messaging: { brokers: ["unused:9092"], clientId: "test" },
};

const healthy = (name: string): HealthCheckable => ({
  name,
  checkHealth: async () => undefined,
});

const failing = (name: string, message: string): HealthCheckable => ({
  name,
  checkHealth: async () => {
    throw new Error(message);
  },
});

const appWith = async (dependencies: readonly HealthCheckable[]) =>
  buildApp({ config, dependencies });

describe("liveness", () => {
  it("reports ok without consulting dependencies", async () => {
    // Liveness must not depend on a database: a dependency outage should stop
    // traffic being routed here, not have the process killed and restarted.
    const app = await appWith([failing("postgres", "down")]);
    after(() => app.close());

    const response = await app.inject({ method: "GET", url: "/health/live" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  });
});

describe("readiness", () => {
  it("is ready when every dependency answers", async () => {
    const app = await appWith([healthy("postgres"), healthy("eventstore"), healthy("kafka")]);
    after(() => app.close());

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "ready");
  });

  it("reports 503 and names the dependency that failed", async () => {
    const app = await appWith([
      healthy("postgres"),
      failing("eventstore", "connection refused"),
      healthy("kafka"),
    ]);
    after(() => app.close());

    const response = await app.inject({ method: "GET", url: "/health/ready" });
    const body = response.json();

    assert.equal(response.statusCode, 503);
    assert.equal(body.status, "degraded");

    const eventstore = body.dependencies.find(
      (dependency: { name: string }) => dependency.name === "eventstore",
    );
    assert.equal(eventstore.healthy, false);
    assert.equal(eventstore.error, "connection refused");

    // The healthy dependencies are still reported, so an operator can see the
    // scope of the outage rather than only its first symptom.
    assert.equal(body.dependencies.filter((d: { healthy: boolean }) => d.healthy).length, 2);
  });

  it("checks dependencies on every request rather than caching the verdict", async () => {
    let calls = 0;
    const app = await appWith([
      {
        name: "postgres",
        checkHealth: async () => {
          calls += 1;
        },
      },
    ]);
    after(() => app.close());

    await app.inject({ method: "GET", url: "/health/ready" });
    await app.inject({ method: "GET", url: "/health/ready" });

    assert.equal(calls, 2);
  });
});

describe("request context", () => {
  it("echoes a trace identifier on every response", async () => {
    const app = await appWith([]);
    after(() => app.close());

    const response = await app.inject({ method: "GET", url: "/health/live" });

    assert.match(response.headers["x-trace-id"] as string, /^[0-9a-f-]{36}$/);
  });

  it("honours an inbound trace identifier so a trace survives the hop", async () => {
    const app = await appWith([]);
    after(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { "x-trace-id": "trace-from-client" },
    });

    assert.equal(response.headers["x-trace-id"], "trace-from-client");
  });
});

describe("error handling", () => {
  it("returns the stable envelope for an unknown route", async () => {
    const app = await appWith([]);
    after(() => app.close());

    const response = await app.inject({ method: "GET", url: "/nope" });
    const body = response.json();

    assert.equal(response.statusCode, 404);
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(typeof body.traceId, "string");
  });

  it("maps a domain error onto its documented status and code", async () => {
    const app = await appWith([]);
    app.get("/denied", async () => {
      throw new UnauthorizedError("Not permitted");
    });
    after(() => app.close());

    const response = await app.inject({ method: "GET", url: "/denied" });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, "AUTHORIZATION_DENIED");
    assert.equal(response.json().message, "Not permitted");
  });

  it("carries client-safe details through", async () => {
    const app = await appWith([]);
    app.get("/missing", async () => {
      throw new NotFoundError("No such Moment", { momentId: "abc" });
    });
    after(() => app.close());

    const response = await app.inject({ method: "GET", url: "/missing" });

    assert.deepEqual(response.json().details, { momentId: "abc" });
  });

  it("never leaks the message of an unexpected error", async () => {
    const app = await appWith([]);
    app.get("/boom", async () => {
      throw new Error("connection to 10.0.0.4 failed: password authentication failed for pg_admin");
    });
    after(() => app.close());

    const response = await app.inject({ method: "GET", url: "/boom" });
    const body = response.json();

    assert.equal(response.statusCode, 500);
    assert.equal(body.code, "INTERNAL_ERROR");
    assert.equal(body.message, "An unexpected error occurred");
    assert.ok(!JSON.stringify(body).includes("pg_admin"));
    assert.ok(!JSON.stringify(body).includes("10.0.0.4"));
  });

  it("ties the error response to the request's trace identifier", async () => {
    const app = await appWith([]);
    app.get("/boom", async () => {
      throw new Error("internal");
    });
    after(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/boom",
      headers: { "x-trace-id": "trace-abc" },
    });

    assert.equal(response.json().traceId, "trace-abc");
  });
});
