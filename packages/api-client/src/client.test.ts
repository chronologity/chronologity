import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { ApiError, createApiClient } from "./client.js";

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const clientWith = (fetchImpl: typeof globalThis.fetch) =>
  createApiClient({ baseUrl: "http://api.test/", fetch: fetchImpl });

describe("createApiClient", () => {
  it("parses the response against the supplied schema", async () => {
    const client = clientWith(async () => jsonResponse({ status: "ok" }));

    const result = await client.request({
      method: "GET",
      path: "/health",
      schema: z.object({ status: z.literal("ok") }),
    });

    assert.deepEqual(result, { status: "ok" });
  });

  it("rejects a response that does not match its schema", async () => {
    const client = clientWith(async () => jsonResponse({ status: "surprise" }));

    await assert.rejects(() =>
      client.request({
        method: "GET",
        path: "/health",
        schema: z.object({ status: z.literal("ok") }),
      }),
    );
  });

  it("maps the stable error envelope onto ApiError", async () => {
    const client = clientWith(async () =>
      jsonResponse(
        {
          code: "AUTHORIZATION_DENIED",
          message: "Not permitted",
          traceId: "trace-123",
        },
        { status: 403 },
      ),
    );

    await assert.rejects(
      () => client.request({ method: "GET", path: "/moments", schema: z.unknown() }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, "AUTHORIZATION_DENIED");
        assert.equal(error.status, 403);
        assert.equal(error.traceId, "trace-123");
        return true;
      },
    );
  });

  it("does not mistake a non-envelope failure for an API contract", async () => {
    // What a proxy or load balancer returns when the API is not reached at all.
    const client = clientWith(
      async () =>
        new Response("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    );

    await assert.rejects(
      () => client.request({ method: "GET", path: "/moments", schema: z.unknown() }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, "INTERNAL_ERROR");
        assert.equal(error.status, 502);
        return true;
      },
    );
  });

  it("sends the bearer token from the callback, resolved per request", async () => {
    let token = "first";
    const seen: (string | null)[] = [];
    const client = createApiClient({
      baseUrl: "http://api.test/",
      getAccessToken: () => token,
      fetch: async (_input, init) => {
        seen.push(new Headers(init?.headers).get("authorization"));
        return jsonResponse({});
      },
    });

    await client.request({ method: "GET", path: "/a", schema: z.unknown() });
    token = "refreshed";
    await client.request({ method: "GET", path: "/b", schema: z.unknown() });

    assert.deepEqual(seen, ["Bearer first", "Bearer refreshed"]);
  });

  it("omits the authorization header when there is no token", async () => {
    let header: string | null = "unset";
    const client = clientWith(async (_input, init) => {
      header = new Headers(init?.headers).get("authorization");
      return jsonResponse({});
    });

    await client.request({ method: "GET", path: "/public", schema: z.unknown() });

    assert.equal(header, null);
  });
});
