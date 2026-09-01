import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, it } from "vitest";
import { testAppConfig } from "../testing/app-config.js";
import { buildApp } from "./app.js";
import type { HealthCheckable } from "./health.js";

/**
 * The application, without the stores behind it.
 *
 * Every test here builds a complete application and injects into it, with no
 * infrastructure at all. That is what `dependencies` being injected buys: the
 * failure path of readiness is the one that matters operationally and the one
 * nobody can reproduce on demand, so it is made reproducible by construction.
 */

const config = testAppConfig();

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

let app: FastifyInstance | undefined;

const appWith = async (dependencies: readonly HealthCheckable[]): Promise<FastifyInstance> => {
  app = await buildApp({ config, dependencies });
  return app;
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("liveness", () => {
  it("answers without consulting anything", async () => {
    const instance = await appWith([failing("clickhouse", "connection refused")]);

    const response = await instance.inject({ method: "GET", url: "/health/live" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  });
});

describe("readiness", () => {
  it("is ready when every store answers", async () => {
    const instance = await appWith([healthy("clickhouse"), healthy("postgres")]);

    const response = await instance.inject({ method: "GET", url: "/health/ready" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: "ready",
      dependencies: [
        { name: "clickhouse", healthy: true },
        { name: "postgres", healthy: true },
      ],
    });
  });

  it("reports 503 and names the store that failed", async () => {
    // Naming it is the point. An operator seeing only "degraded" learns that
    // something is wrong; seeing "clickhouse" learns the scope of the outage.
    const instance = await appWith([
      failing("clickhouse", "connection refused"),
      healthy("postgres"),
    ]);

    const response = await instance.inject({ method: "GET", url: "/health/ready" });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: "degraded",
      dependencies: [
        { name: "clickhouse", healthy: false, error: "connection refused" },
        { name: "postgres", healthy: true },
      ],
    });
  });
});

describe("the request envelope", () => {
  it("answers an unknown path with the shared error shape", async () => {
    const instance = await appWith([]);

    const response = await instance.inject({ method: "GET", url: "/timeline" });
    const body = response.json();

    assert.equal(response.statusCode, 404);
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(typeof body.traceId, "string");
  });

  it("honours an inbound trace identifier so a trace survives the hop", async () => {
    const instance = await appWith([]);

    const response = await instance.inject({
      method: "GET",
      url: "/health/live",
      headers: { "x-trace-id": "carried-from-the-client" },
    });

    assert.equal(response.headers["x-trace-id"], "carried-from-the-client");
  });

  it("generates a trace identifier when the client sends none", async () => {
    const instance = await appWith([]);

    const response = await instance.inject({ method: "GET", url: "/health/live" });

    assert.equal(typeof response.headers["x-trace-id"], "string");
    assert.notEqual(response.headers["x-trace-id"], "");
  });
});

describe("the GraphQL surface", () => {
  it("is absent when no store was provided to read through", async () => {
    // A schema with nothing behind it would answer questions it cannot answer.
    const instance = await appWith([]);

    const response = await instance.inject({
      method: "POST",
      url: "/graphql",
      payload: { query: "{ viewer { authenticated } }" },
    });

    assert.equal(response.statusCode, 404);
  });
});
