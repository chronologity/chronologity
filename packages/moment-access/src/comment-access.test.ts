import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { commentReadableBy } from "./comment-access.js";
import { NAMED_VIEWER, PositionalParameters } from "./placeholders.js";

/**
 * Whether a Viewer may read a comment.
 *
 * A different question from whether they may read the Moment above it, asked
 * about a different person: the commenter, not the author.
 */

const named = (): string => commentReadableBy("comment", NAMED_VIEWER);

describe("what the comment rule asks", () => {
  it("admits the commenter themselves before anything else", () => {
    // So neither a suspension nor a moderator's decision hides somebody's own
    // words from them, which is what makes an appeal possible.
    assert.match(named(), /^\(\s*comment\.author_user_id = :viewerUserId\s*OR/);
  });

  it("separates two people by a Block in either direction", () => {
    assert.ok(named().includes("b.blocker_user_id = comment.author_user_id"));
    assert.ok(named().includes("b.blocker_user_id = :viewerUserId"));
  });

  it("withholds a suspended commenter's words", () => {
    assert.ok(named().includes("commenter.status = 'suspended'"));
  });

  it("withholds what moderation took down, and only those states", () => {
    assert.ok(named().includes("ms.subject_type = 'comment'"));
    assert.ok(named().includes("ms.state IN ('removed', 'temporarily_unavailable')"));
    assert.ok(!named().includes("age_restricted"));
    assert.ok(!named().includes("warned"));
  });

  it("asks nothing about age", () => {
    // Comments carry no age gate: reaching one means having passed the Moment's.
    assert.ok(!named().includes("viewerIsAdult"));
  });

  it("reads the comment table under the alias it is given", () => {
    assert.ok(!commentReadableBy("c", NAMED_VIEWER).includes("comment."));
  });
});

describe("the dialects", () => {
  it("renders positionally without a colon anywhere", () => {
    const bind = new PositionalParameters();
    const sql = commentReadableBy("c", { viewerUserId: bind.bind("somebody") });

    assert.ok(sql.includes("$1"));
    assert.ok(!sql.includes(":viewerUserId"));
    assert.deepEqual(bind.values, ["somebody"]);
  });

  it("emits no placeholder the caller did not supply", () => {
    // The property that makes one rule safe for two clients: every hole in the
    // text came from the caller, so neither dialect leaks into the other.
    const sql = commentReadableBy("c", { viewerUserId: "@@viewer@@" });

    assert.ok(!sql.includes("$"));
    assert.ok(!/:[a-zA-Z]/.test(sql));
  });
});
