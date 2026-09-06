import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createApiClient } from "../client.js";
import { checkLiveness, checkReadiness } from "./health.js";

describe("asking whether the API is working", () => {
  it("carries what it is, so a test can read it", async () => {
    // The property the completeness check depends on: an operation says its own
    // method and path, so something can compare the set against the document.
    assert.equal(checkLiveness.method, "GET");
    assert.equal(checkLiveness.template, "/health/live");
  });

  it("calls the route it names", async () => {
    let seen = "";
    const client = createApiClient({
      baseUrl: "http://api.test/",
      fetch: async (input) => {
        seen = new URL(String(input)).pathname;

        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      },
    });

    assert.deepEqual(await checkLiveness(client, {}), { status: "ok" });
    assert.equal(seen, "/health/live");
  });

  it("parses a degraded answer rather than only a healthy one", async () => {
    // Readiness answers 503 when a dependency cannot serve, and the body is the
    // useful part: which one.
    const client = createApiClient({
      baseUrl: "http://api.test/",
      fetch: async () =>
        new Response(
          JSON.stringify({
            status: "degraded",
            dependencies: [{ name: "postgres", healthy: false, error: "unreachable" }],
          }),
          { status: 200 },
        ),
    });

    const answer = await checkReadiness(client, {});

    assert.equal(answer.status, "degraded");
    assert.equal(answer.dependencies[0]?.healthy, false);
  });
});
