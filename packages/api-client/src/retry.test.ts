import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { ApiError } from "./api-error.js";
import { createApiClient } from "./client.js";
import { classify, defaultRetryPolicy, delayFor, mayRetry, TransportError } from "./retry.js";

/**
 * What may be tried again.
 *
 * The decision this suite protects is not "does retrying work" — it is **which
 * failures may be retried at all**, and the expensive mistake is retrying a
 * `POST`. A recorded Moment whose response was lost on the way back is
 * indistinguishable, from here, from one that never arrived; retrying records a
 * second one, and there are no idempotency keys in this system to make it safe.
 */

const envelope = (code: string, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ code, message: "no", traceId: "t" }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/**
 * A client that counts attempts and never actually waits.
 *
 * @param responses - What to answer, in order. The last repeats.
 * @returns The client and a counter.
 */
function counting(responses: (() => Response | Promise<never>)[]) {
  const state = { attempts: 0, waited: [] as number[] };
  const client = createApiClient({
    baseUrl: "http://api.test/",
    sleep: async (ms) => {
      state.waited.push(ms);
    },
    fetch: async () => {
      const next = responses[Math.min(state.attempts, responses.length - 1)];

      state.attempts += 1;

      return next!();
    },
  });

  return { client, state };
}

describe("what may be retried", () => {
  it("retries a rate limit on a read", async () => {
    const { client, state } = counting([
      () => envelope("RATE_LIMITED", 429),
      () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ]);

    const result = await client.request({ method: "GET", path: "/a", schema: z.object({ ok: z.boolean() }) });

    assert.deepEqual(result, { ok: true });
    assert.equal(state.attempts, 2);
  });

  it("never retries a POST, however transient the failure looks", async () => {
    // The assertion this suite exists for. A rate limit is retryable by code;
    // recording a Moment is not retryable by method, and method wins.
    const { client, state } = counting([() => envelope("RATE_LIMITED", 429)]);

    await assert.rejects(() =>
      client.request({ method: "POST", path: "/moments", schema: z.unknown(), body: {} }),
    );
    assert.equal(state.attempts, 1, "a POST was retried");
  });

  it("retries a POST the caller declared safe to repeat", async () => {
    // `POST /uploads/:id/finalize` is documented idempotent. Declared per
    // operation, because nothing about a path says so.
    const { client, state } = counting([
      () => envelope("PROVIDER_UNAVAILABLE", 503),
      () => new Response(null, { status: 204 }),
    ]);

    await client.request({
      method: "POST",
      path: "/uploads/x/finalize",
      schema: z.void(),
      idempotent: true,
    });

    assert.equal(state.attempts, 2);
  });

  it("does not retry a refusal that will be refused again", async () => {
    const { client, state } = counting([() => envelope("AUTHORIZATION_DENIED", 403)]);

    await assert.rejects(() => client.request({ method: "GET", path: "/a", schema: z.unknown() }));
    assert.equal(state.attempts, 1);
  });

  it("gives up after the policy's attempts rather than forever", async () => {
    // `principles.md:1583`: "infinite silent retries hide broken systems."
    const { client, state } = counting([() => envelope("PROVIDER_UNAVAILABLE", 503)]);

    await assert.rejects(() => client.request({ method: "GET", path: "/a", schema: z.unknown() }));
    assert.equal(state.attempts, defaultRetryPolicy.attempts);
  });

  it("waits as long as the server asked", async () => {
    // Guessing shorter than `Retry-After` is how a client turns a rate limit
    // into a longer one.
    const { client, state } = counting([
      () => envelope("RATE_LIMITED", 429, { "retry-after": "2" }),
      () => new Response(JSON.stringify({}), { status: 200 }),
    ]);

    await client.request({ method: "GET", path: "/a", schema: z.unknown() });

    assert.deepEqual(state.waited, [2000]);
  });

  it("never waits longer than the ceiling, whatever the server asked", async () => {
    const { client, state } = counting([
      () => envelope("RATE_LIMITED", 429, { "retry-after": "3600" }),
      () => new Response(JSON.stringify({}), { status: 200 }),
    ]);

    await client.request({ method: "GET", path: "/a", schema: z.unknown() });

    assert.deepEqual(state.waited, [defaultRetryPolicy.maxDelayMs]);
  });
});

describe("a request that never got an answer", () => {
  it("calls a dropped connection what it is, and retries it", async () => {
    // `fetch` reports every network failure as a TypeError. Before this, that
    // reached a caller as an unrecognised crash.
    const { client, state } = counting([
      () => Promise.reject(new TypeError("fetch failed")),
      () => new Response(JSON.stringify({}), { status: 200 }),
    ]);

    await client.request({ method: "GET", path: "/a", schema: z.unknown() });

    assert.equal(state.attempts, 2);
  });

  it("does not retry work the caller asked to stop", async () => {
    const controller = new AbortController();
    const client = createApiClient({
      baseUrl: "http://api.test/",
      sleep: async () => undefined,
      fetch: async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      },
    });

    await assert.rejects(
      () => client.request({ method: "GET", path: "/a", schema: z.unknown(), signal: controller.signal }),
      (error: unknown) => error instanceof TransportError && !error.retryable,
    );
  });
});

describe("classifying by hand", () => {
  it("leaves an answered request alone", async () => {
    // The server answered; its answer is the classification.
    const answered = new ApiError(403, { code: "AUTHORIZATION_DENIED", message: "no", traceId: "t" });

    assert.equal(classify(answered, undefined), answered);
  });

  it("spreads retries rather than clustering them", async () => {
    // Without jitter every client that failed at one moment retries at one
    // moment, which is the failure a backoff exists to prevent.
    const delays = Array.from({ length: 40 }, () => delayFor(2, undefined, defaultRetryPolicy));

    assert.ok(new Set(delays).size > 1, "every delay was identical");
    assert.ok(Math.max(...delays) <= defaultRetryPolicy.maxDelayMs);
  });

  it("refuses a POST before it looks at the error at all", async () => {
    const transient = new TransportError("gone", true);

    assert.equal(mayRetry(transient, "POST", false), false);
    assert.equal(mayRetry(transient, "GET", false), true);
  });
});
