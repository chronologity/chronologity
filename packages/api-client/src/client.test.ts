import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { ApiError } from "./api-error.js";
import { createApiClient } from "./client.js";

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

describe("a response that carries no body", () => {
  const empty = () => new Response(null, { status: 204 });

  it("answers a route describing its silence as void", async () => {
    const client = clientWith(async () => empty());

    const result = await client.request({ method: "DELETE", path: "/a", schema: z.void() });

    assert.equal(result, undefined);
  });

  it("answers a route describing its silence as null", async () => {
    // Six routes in this API spell it this way, deleting a Moment among them.
    // Parsing `undefined` unconditionally threw *after the server had already
    // succeeded* — the Moment was gone and the caller saw a validation failure.
    const client = clientWith(async () => empty());

    const result = await client.request({ method: "DELETE", path: "/a", schema: z.null() });

    assert.equal(result, null);
  });

  it("still refuses a route that documents a body it cannot have", async () => {
    // The guard against being too permissive: a 204 declaring an object is a
    // route that is wrong, and quietly returning undefined would hide it.
    const client = clientWith(async () => empty());

    await assert.rejects(() =>
      client.request({ method: "DELETE", path: "/a", schema: z.object({ id: z.string() }) }),
    );
  });
});

describe("following a request into the server's logs", () => {
  it("sends a trace identifier the API will echo", async () => {
    let header: string | null = null;
    const client = createApiClient({
      baseUrl: "http://api.test/",
      fetch: async (_input, init) => {
        header = new Headers(init?.headers).get("x-trace-id");
        return jsonResponse({});
      },
      newTraceId: () => "known-trace",
    });

    await client.request({ method: "GET", path: "/a", schema: z.unknown() });

    assert.equal(header, "known-trace");
  });

  it("carries a caller's own identifier rather than inventing one", async () => {
    // A screen already tracing a user action wants the whole action under one
    // identifier, not one per request it happens to make.
    let header: string | null = null;
    const client = clientWith(async (_input, init) => {
      header = new Headers(init?.headers).get("x-trace-id");
      return jsonResponse({});
    });

    await client.request({ method: "GET", path: "/a", schema: z.unknown(), traceId: "mine" });

    assert.equal(header, "mine");
  });

  it("sends no identifier where the runtime cannot produce one", async () => {
    // React Native has no global `crypto` without a polyfill. Omitting the
    // header costs correlation; throwing would cost the request.
    let sent = true;
    const client = createApiClient({
      baseUrl: "http://api.test/",
      fetch: async (_input, init) => {
        sent = new Headers(init?.headers).has("x-trace-id");
        return jsonResponse({});
      },
      newTraceId: () => undefined,
    });

    await client.request({ method: "GET", path: "/a", schema: z.unknown() });

    assert.equal(sent, false);
  });
});
