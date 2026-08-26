import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { decodeSearchCursor, encodeSearchCursor } from "./search.cursor.js";
import { RANKING_VERSION } from "./search.ranking.js";

const cursor = (over: Partial<Parameters<typeof encodeSearchCursor>[0]> = {}) =>
  encodeSearchCursor({
    fingerprint: "abc123",
    rankingVersion: RANKING_VERSION,
    offset: 20,
    at: "1998-06-01T00:00:00.000Z",
    id: "moment-1",
    ...over,
  });

describe("decodeSearchCursor", () => {
  it("reads back what it wrote", () => {
    const decoded = decodeSearchCursor(cursor(), "abc123");

    assert.equal(decoded?.offset, 20);
    assert.equal(decoded?.at, "1998-06-01T00:00:00.000Z");
    assert.equal(decoded?.id, "moment-1");
  });

  it("treats no cursor as a first page", () => {
    assert.equal(decodeSearchCursor(undefined, "abc123"), undefined);
  });

  it("refuses a cursor from a different search", () => {
    // Paging through one answer using a position from another would splice two
    // orderings together without telling anybody.
    assert.throws(() => decodeSearchCursor(cursor(), "different"), ValidationError);
  });

  it("refuses a cursor from a different ranking version", () => {
    assert.throws(
      () => decodeSearchCursor(cursor({ rankingVersion: "ranking-v0" }), "abc123"),
      ValidationError,
    );
  });

  it("refuses something that is not a cursor at all", () => {
    // Refused rather than treated as a first page: silently restarting looks to
    // the caller like results repeating.
    assert.throws(() => decodeSearchCursor("nonsense", "abc123"), ValidationError);
  });

  it("refuses a well-formed encoding of the wrong shape", () => {
    const wrong = Buffer.from(JSON.stringify({ offset: 20 }), "utf8").toString("base64url");

    assert.throws(() => decodeSearchCursor(wrong, "abc123"), ValidationError);
  });

  it("refuses an encoding with the wrong number of parts", () => {
    const short = Buffer.from(JSON.stringify(["abc123", RANKING_VERSION]), "utf8").toString(
      "base64url",
    );

    assert.throws(() => decodeSearchCursor(short, "abc123"), ValidationError);
  });

  it("refuses a negative position", () => {
    assert.throws(() => decodeSearchCursor(cursor({ offset: -1 }), "abc123"), ValidationError);
  });

  it("refuses a position that is not a whole number", () => {
    assert.throws(() => decodeSearchCursor(cursor({ offset: 1.5 }), "abc123"), ValidationError);
  });

  it("reads a cursor with no occurrence, which a User result has", () => {
    const decoded = decodeSearchCursor(cursor({ at: undefined, id: undefined }), "abc123");

    assert.equal(decoded?.at, undefined);
    assert.equal(decoded?.offset, 20);
  });

  it("says which of the two refusals happened", () => {
    // A caller can retry a reordered search from the start; a caller who sent
    // the wrong cursor entirely has a different bug. Telling them apart is the
    // difference between a useful message and a shrug.
    const reordered = decodeSearchCursor.bind(
      null,
      cursor({ rankingVersion: "ranking-v0" }),
      "abc123",
    );
    const foreign = decodeSearchCursor.bind(null, cursor(), "different");

    assert.throws(reordered, /reordered/iu);
    assert.throws(foreign, /different search/iu);
  });
});
