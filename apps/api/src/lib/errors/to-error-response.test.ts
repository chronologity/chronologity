import assert from "node:assert/strict";
import { CursorError } from "@chronologity/timeline-derivation";
import { describe, it } from "vitest";
import { NotFoundError } from "./not-found-error.js";
import { UnauthenticatedError, UnauthorizedError } from "./unauthorized-error.js";
import { toErrorResponse } from "./to-error-response.js";
import { ValidationError } from "./validation-error.js";

const traceId = "trace-1";

describe("toErrorResponse", () => {
  it("refuses a cursor it did not issue as a validation failure", () => {
    // Regression. The cursor codec moved into a shared package and started
    // throwing the package's own error rather than a `DomainError`, which is
    // right — a package shared with the feed aggregator must not choose an HTTP
    // status for both — but it meant a forged cursor answered 500 until this
    // translation existed. The integration suite caught it; this pins it.
    const { status, body } = toErrorResponse(new CursorError("That is not a usable cursor"), "t-1");

    assert.equal(status, 400);
    assert.equal(body.code, "VALIDATION_FAILED");
    assert.equal(body.message, "That is not a usable cursor");
    assert.deepEqual(body.details, { field: "cursor" });
    assert.equal(body.traceId, "t-1");
  });

  it("maps a domain error to its documented status and code", () => {
    for (const [error, status, code] of [
      [new NotFoundError("gone"), 404, "NOT_FOUND"],
      [new UnauthenticatedError("who?"), 401, "AUTHENTICATION_FAILED"],
      [new UnauthorizedError("no"), 403, "AUTHORIZATION_DENIED"],
      [new ValidationError("bad"), 400, "VALIDATION_FAILED"],
    ] as const) {
      const mapped = toErrorResponse(error, traceId);

      assert.equal(mapped.status, status);
      assert.equal(mapped.body.code, code);
      assert.equal(mapped.body.traceId, traceId);
    }
  });

  it("passes client-safe details through", () => {
    const mapped = toErrorResponse(new NotFoundError("gone", { momentId: "abc" }), traceId);

    assert.deepEqual(mapped.body.details, { momentId: "abc" });
  });

  it("honours a framework rejection's 4xx status", () => {
    // Rate limits, oversized bodies, and unsupported media types are refusals
    // the system meant. Reporting them as 500 would claim a failure that did
    // not happen, and would hide a working control.
    for (const [status, code] of [
      [429, "RATE_LIMITED"],
      [413, "VALIDATION_FAILED"],
      [415, "VALIDATION_FAILED"],
      [400, "VALIDATION_FAILED"],
    ] as const) {
      const mapped = toErrorResponse(
        Object.assign(new Error("framework"), { statusCode: status }),
        traceId,
      );

      assert.equal(mapped.status, status);
      assert.equal(mapped.body.code, code);
    }
  });

  it("does not repeat the framework's own wording", () => {
    const mapped = toErrorResponse(
      Object.assign(new Error("Rate limit exceeded, retry in 1 minute"), { statusCode: 429 }),
      traceId,
    );

    assert.equal(mapped.body.message, "Too many requests");
  });

  it("treats a 5xx from a plugin as an unexpected failure", () => {
    const mapped = toErrorResponse(
      Object.assign(new Error("upstream exploded at 10.0.0.4"), { statusCode: 503 }),
      traceId,
    );

    assert.equal(mapped.status, 500);
    assert.equal(mapped.body.code, "INTERNAL_ERROR");
    assert.ok(!JSON.stringify(mapped.body).includes("10.0.0.4"));
  });

  it("ignores a nonsensical statusCode", () => {
    for (const statusCode of ["429", 4.5, null, 999, 200]) {
      const mapped = toErrorResponse(Object.assign(new Error("odd"), { statusCode }), traceId);

      assert.equal(mapped.status, 500);
    }
  });

  it("never leaks an unexpected error's message", () => {
    const mapped = toErrorResponse(
      new Error("password authentication failed for user pg_admin"),
      traceId,
    );

    assert.equal(mapped.status, 500);
    assert.equal(mapped.body.message, "An unexpected error occurred");
    assert.ok(!JSON.stringify(mapped.body).includes("pg_admin"));
  });

  it("handles a thrown value that is not an error at all", () => {
    for (const thrown of ["a string", 42, null, undefined, {}]) {
      const mapped = toErrorResponse(thrown, traceId);

      assert.equal(mapped.status, 500);
      assert.equal(mapped.body.code, "INTERNAL_ERROR");
    }
  });
});
