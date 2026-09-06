import assert from "node:assert/strict";
import { listMomentsRequestSchema, searchRequestSchema } from "@chronologity/contracts";
import { describe, it } from "vitest";
import { z } from "zod";
import { queryString } from "./query.js";

/**
 * What a caller asked for, as the server reads it.
 *
 * Driven against the real contract schemas rather than invented ones, because
 * the bounds and defaults being applied are the whole reason this parses before
 * it serialises. A test with its own schema would prove the serialiser works and
 * nothing about whether it works on this API.
 */

describe("asking for a page", () => {
  it("sends the default the server would otherwise assume", async () => {
    // Applying the default here rather than omitting it makes the page size
    // visible in a log rather than implied by its absence.
    assert.equal(queryString(listMomentsRequestSchema, {}), "?limit=20");
  });

  it("carries a cursor", async () => {
    const query = queryString(listMomentsRequestSchema, { limit: 50, cursor: "abc" });

    assert.equal(query, "?limit=50&cursor=abc");
  });

  it("omits an absent cursor rather than sending an empty one", async () => {
    // `?cursor=` is a cursor the server must decode and refuse. Omitting it is
    // the beginning of the list.
    assert.equal(queryString(listMomentsRequestSchema, { limit: 20, cursor: undefined }), "?limit=20");
  });

  it("refuses a page size the server would refuse, and says which field", async () => {
    // The error names `limit` here; as a 400 it would arrive as a status code
    // and a message somebody has to read.
    await assert.rejects(
      async () => queryString(listMomentsRequestSchema, { limit: 500 }),
      (error: unknown) => error instanceof z.ZodError && JSON.stringify(error).includes("limit"),
    );
  });
});

describe("searching", () => {
  it("carries the words and the filters together", async () => {
    const query = queryString(searchRequestSchema, { q: "the old pier", type: "moment" });

    assert.ok(query.includes("q=the+old+pier"), query);
    assert.ok(query.includes("type=moment"), query);
    assert.ok(query.includes("sort=relevance"), query);
  });

  it("escapes what a person actually typed", async () => {
    // A search is the one field where a caller's own text reaches a URL.
    const query = queryString(searchRequestSchema, { q: "a&b=c?d#e" });

    assert.ok(query.includes("q=a%26b%3Dc%3Fd%23e"), query);
  });

  it("writes a moment in time the way the contract spells it", async () => {
    const query = queryString(searchRequestSchema, { from: "1998-07-04T19:30:00.000Z" });

    assert.ok(query.includes("from=1998-07-04T19%3A30%3A00.000Z"), query);
  });
});

describe("what it will not encode", () => {
  it("repeats a key for each value of a list", async () => {
    const schema = z.object({ kind: z.array(z.string()) });

    assert.equal(queryString(schema, { kind: ["image", "video"] }), "?kind=image&kind=video");
  });

  it("returns nothing at all when there is nothing to say", async () => {
    // So a caller can append it to a path unconditionally without producing a
    // trailing `?`.
    assert.equal(queryString(z.object({}), {}), "");
  });

  it("refuses a shape a query string cannot carry", async () => {
    // A nested object would have to be encoded by some convention the server was
    // never taught. Failing here is better than sending something it misreads.
    const schema = z.object({ where: z.object({ near: z.string() }) });

    await assert.rejects(
      async () => queryString(schema, { where: { near: "here" } }),
      (error: unknown) => error instanceof TypeError && error.message.includes("where"),
    );
  });
});
