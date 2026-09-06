import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { UploadAuthorization } from "@chronologity/contracts";
import { describe, it } from "vitest";
import { TransportError } from "./retry.js";
import { putUpload } from "./uploads.js";

/**
 * Carrying bytes to storage.
 *
 * The assertion that matters most is an **absence**: no `Authorization` header.
 * The signature in the URL is the authority, and adding a bearer token makes the
 * request a different one from the one that was signed — so storage refuses it,
 * with a 403 that reads exactly like a bug in the signing.
 */

const NOW = Date.parse("2026-01-01T12:00:00.000Z");

/**
 * An authorisation as `POST /uploads` returns one.
 *
 * @param over - Anything a case needs different.
 * @returns The authorisation.
 */
function authorization(over: Partial<UploadAuthorization> = {}): UploadAuthorization {
  return {
    uploadId: randomUUID(),
    kind: "image",
    uploadUrl: "http://storage.test/bucket/key?X-Amz-Signature=abc",
    contentType: "image/jpeg",
    uploadUrlExpiresAt: new Date(NOW + 900_000).toISOString(),
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
    maximumByteSize: 26_214_400,
    ...over,
  };
}

const bytes = new Uint8Array([1, 2, 3]);

describe("writing bytes to storage", () => {
  it("sends no authorization header", async () => {
    // The assertion this suite exists for. The signature is the authority; a
    // bearer token makes it a different request from the one signed.
    let headers = new Headers();
    await putUpload({
      authorization: authorization(),
      body: bytes,
      now: () => NOW,
      fetch: async (_input, init) => {
        headers = new Headers(init?.headers);

        return new Response(null, { status: 200 });
      },
    });

    assert.equal(headers.get("authorization"), null);
  });

  it("sends exactly the content type it was given", async () => {
    // Covered by the signature, so `image/jpeg` where the authorisation said
    // something else is a mismatch rather than a synonym.
    let contentType: string | null = null;
    await putUpload({
      authorization: authorization({ contentType: "video/quicktime" }),
      body: bytes,
      now: () => NOW,
      fetch: async (_input, init) => {
        contentType = new Headers(init?.headers).get("content-type");

        return new Response(null, { status: 200 });
      },
    });

    assert.equal(contentType, "video/quicktime");
  });

  it("puts the bytes at the signed URL, unchanged", async () => {
    let url = "";
    let method = "";
    await putUpload({
      authorization: authorization(),
      body: bytes,
      now: () => NOW,
      fetch: async (input, init) => {
        url = String(input);
        method = init?.method ?? "";

        return new Response(null, { status: 200 });
      },
    });

    assert.equal(method, "PUT");
    assert.ok(url.includes("X-Amz-Signature=abc"), url);
  });
});

describe("when it cannot be written", () => {
  it("refuses before sending once the signature has expired", async () => {
    // Storage answers an expired signature with a 403 that reads exactly like a
    // malformed one, and the caller's next move differs entirely: register
    // again, or fix a bug.
    let sent = false;

    await assert.rejects(
      () =>
        putUpload({
          authorization: authorization({ uploadUrlExpiresAt: new Date(NOW - 1).toISOString() }),
          body: bytes,
          now: () => NOW,
          fetch: async () => {
            sent = true;

            return new Response(null, { status: 200 });
          },
        }),
      (error: unknown) =>
        error instanceof TransportError && error.message.includes("Register the upload again"),
    );
    assert.equal(sent, false, "it sent bytes to a signature that had expired");
  });

  it("says nothing about what storage said", async () => {
    // Storage's body is XML naming the bucket and the key. Neither belongs in
    // front of somebody, and neither belongs in a log written here.
    await assert.rejects(
      () =>
        putUpload({
          authorization: authorization(),
          body: bytes,
          now: () => NOW,
          fetch: async () =>
            new Response("<Error><Key>moments/private/abc.jpg</Key></Error>", { status: 403 }),
        }),
      (error: unknown) =>
        error instanceof TransportError &&
        !error.message.includes("moments/") &&
        error.message.includes("403"),
    );
  });

  it("calls a storage outage worth trying again, and a refusal not", async () => {
    const refused = putUpload({
      authorization: authorization(),
      body: bytes,
      now: () => NOW,
      fetch: async () => new Response(null, { status: 403 }),
    });
    const unavailable = putUpload({
      authorization: authorization(),
      body: bytes,
      now: () => NOW,
      fetch: async () => new Response(null, { status: 503 }),
    });

    await assert.rejects(refused, (e: unknown) => e instanceof TransportError && !e.retryable);
    await assert.rejects(unavailable, (e: unknown) => e instanceof TransportError && e.retryable);
  });

  it("does not ask to retry something the caller cancelled", async () => {
    const controller = new AbortController();

    await assert.rejects(
      () =>
        putUpload({
          authorization: authorization(),
          body: bytes,
          signal: controller.signal,
          now: () => NOW,
          fetch: async () => {
            controller.abort();
            throw new DOMException("aborted", "AbortError");
          },
        }),
      (error: unknown) => error instanceof TransportError && !error.retryable,
    );
  });
});
