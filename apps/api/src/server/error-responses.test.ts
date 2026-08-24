import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { errors } from "./error-responses.js";

describe("errors", () => {
  it("includes what the route asked for", () => {
    const declared = errors(401, 404);

    assert.ok(401 in declared);
    assert.ok(404 in declared);
  });

  it("always includes the ones every route can produce", () => {
    const declared = errors(404);

    // Rate limiting is global and anything can fail, so declaring these by hand
    // on every route would be ceremony.
    assert.ok(429 in declared);
    assert.ok(500 in declared);
  });

  it("includes nothing the route did not ask for", () => {
    const declared = errors(404);

    // A health check has no 401 to give, and a specification that says
    // otherwise is worse than one that says nothing.
    assert.equal(401 in declared, false);
    assert.equal(400 in declared, false);
  });

  it("survives being asked for a universal status explicitly", () => {
    const declared = errors(429, 500, 404);

    assert.deepEqual(Object.keys(declared), ["404", "429", "500"]);
  });

  it("describes every status it returns", () => {
    const declared = errors(400, 401, 403, 404, 413, 415);

    for (const [status, schema] of Object.entries(declared)) {
      assert.ok((schema.description ?? "").length > 20, `${status} is undescribed`);
    }
  });

  it("warns that a refusal is not proof of absence", () => {
    // The single most important thing a client developer needs to know about
    // this API, which is why it lives here rather than on forty routes.
    assert.match(errors(404)[404]?.description ?? "", /never be read as proof/i);
  });
});
