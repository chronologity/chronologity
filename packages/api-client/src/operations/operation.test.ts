import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { createApiClient, type ApiClient, type RequestOptions } from "../client.js";
import { defineOperation } from "./operation.js";

/**
 * Every one of the hundred and sixty-three operations is this function with
 * different data, so what it decides is decided once for all of them.
 */

interface Seen {
  method: string;
  path: string;
  body: unknown;
  idempotent: boolean | undefined;
  traceId: string | undefined;
}

/**
 * A client that records the request instead of making it.
 *
 * @param answer - What to resolve the response as.
 * @returns The client and the record it writes into.
 */
function recording(answer: unknown = {}): { client: ApiClient; seen: Seen } {
  const seen: Seen = {
    method: "",
    path: "",
    body: undefined,
    idempotent: undefined,
    traceId: undefined,
  };

  const client: ApiClient = {
    request: async <Schema extends z.ZodType>(options: RequestOptions<Schema>) => {
      seen.method = options.method;
      seen.path = options.path;
      seen.body = options.body;
      seen.idempotent = options.idempotent;
      seen.traceId = options.traceId;

      return options.schema.parse(answer) as z.infer<Schema>;
    },
  };

  return { client, seen };
}

describe("describing one thing the API can do", () => {
  it("carries its method and path, so the completeness check can read them", () => {
    const operation = defineOperation({
      method: "GET",
      template: "/moments/:momentId",
      path: (args: { params: { momentId: string } }) => `/moments/${args.params.momentId}`,
      response: z.object({ id: z.string() }),
    });

    assert.equal(operation.method, "GET");
    assert.equal(operation.template, "/moments/:momentId");
    assert.equal(operation.sendsBody, false);
    assert.equal(operation.sendsQuery, false);
  });

  it("sends the template unchanged when there are no placeholders", async () => {
    const operation = defineOperation({
      method: "GET",
      template: "/moments",
      response: z.object({}),
    });
    const { client, seen } = recording();

    await operation(client, {});

    assert.equal(seen.path, "/moments");
  });

  it("fills the placeholders from the arguments", async () => {
    const operation = defineOperation({
      method: "DELETE",
      template: "/users/:userId/roles/:role",
      path: (args: { params: { userId: string; role: string } }) =>
        `/users/${args.params.userId}/roles/${args.params.role}`,
      response: z.object({}),
    });
    const { client, seen } = recording();

    await operation(client, { params: { userId: "u-1", role: "moderator" } });

    assert.equal(seen.path, "/users/u-1/roles/moderator");
    assert.equal(operation.pathFor({ params: { userId: "u-1", role: "moderator" } }), seen.path);
  });

  it("appends a query string only where the operation declares one", async () => {
    const operation = defineOperation({
      method: "GET",
      template: "/moments",
      query: z.object({ limit: z.number().default(20) }),
      response: z.object({}),
    });
    const { client, seen } = recording();

    await operation(client, { query: {} });

    // The contract's default is applied here, so the page size is visible in a
    // log rather than implied by its absence.
    assert.equal(seen.path, "/moments?limit=20");
    assert.equal(operation.sendsQuery, true);
  });

  it("refuses a request the server would refuse, naming the field", async () => {
    const operation = defineOperation({
      method: "GET",
      template: "/moments",
      query: z.object({ limit: z.number().max(100) }),
      response: z.object({}),
    });
    const { client } = recording();

    await assert.rejects(
      operation(client, { query: { limit: 500 } }),
      (error: unknown) => error instanceof z.ZodError,
    );
  });

  it("parses the body before sending it", async () => {
    const operation = defineOperation({
      method: "POST",
      template: "/moments",
      body: z.object({ caption: z.string().max(5) }),
      response: z.object({}),
    });
    const { client, seen } = recording();

    await operation(client, { body: { caption: "short" } });

    assert.deepEqual(seen.body, { caption: "short" });
    assert.equal(operation.sendsBody, true);

    await assert.rejects(operation(client, { body: { caption: "far too long" } }));
  });

  it("sends no body where none is declared", async () => {
    const operation = defineOperation({
      method: "POST",
      template: "/moments/:momentId/publish",
      path: (args: { params: { momentId: string } }) => `/moments/${args.params.momentId}/publish`,
      response: z.object({}),
    });
    const { client, seen } = recording();

    await operation(client, { params: { momentId: "m-1" } });

    // Undefined rather than `{}`: an empty object is a body, and a route that
    // declares none would have to decide what to do with it.
    assert.equal(seen.body, undefined);
  });

  it("is not retryable unless it says so", async () => {
    const ordinary = defineOperation({
      method: "POST",
      template: "/moments",
      response: z.object({}),
    });
    const repeatable = defineOperation({
      method: "POST",
      template: "/uploads/:uploadId/finalize",
      path: (args: { params: { uploadId: string } }) => `/uploads/${args.params.uploadId}/finalize`,
      idempotent: true,
      response: z.object({}),
    });

    assert.equal(ordinary.idempotent, false);
    assert.equal(repeatable.idempotent, true);
  });

  it("passes a caller's trace identifier through", async () => {
    const operation = defineOperation({
      method: "GET",
      template: "/moments",
      response: z.object({}),
    });
    const { client, seen } = recording();

    await operation(client, {}, { traceId: "trace-1" });

    assert.equal(seen.traceId, "trace-1");
  });

  it("parses what comes back rather than trusting it", async () => {
    const operation = defineOperation({
      method: "GET",
      template: "/moments/:momentId",
      path: (args: { params: { momentId: string } }) => `/moments/${args.params.momentId}`,
      response: z.object({ id: z.string(), occurredAt: z.string() }),
    });
    const { client } = recording({ id: "m-1" });

    await assert.rejects(operation(client, { params: { momentId: "m-1" } }));
  });

  it("abandons a call when the caller aborts it", async () => {
    const operation = defineOperation({
      method: "GET",
      template: "/moments",
      response: z.object({}),
    });
    const controller = new AbortController();
    const client = createApiClient({
      baseUrl: "http://api.test/",
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const fail = (): void => {
            reject(new DOMException("aborted", "AbortError"));
          };

          if (signal?.aborted === true) {
            fail();

            return;
          }

          signal?.addEventListener("abort", fail);
          setTimeout(() => {
            controller.abort();
          }, 0);
        }),
    });

    await assert.rejects(operation(client, {}, { signal: controller.signal }));
  });
});
