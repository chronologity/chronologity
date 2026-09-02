import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { findMentionedHandles } from "./comment-mentions.js";

describe("findMentionedHandles", () => {
  it("finds a handle", () => {
    assert.deepEqual(findMentionedHandles("thanks @alice"), ["alice"]);
  });

  it("finds several, in the order they appear", () => {
    assert.deepEqual(findMentionedHandles("@bob and @alice were there"), ["bob", "alice"]);
  });

  it("counts somebody mentioned twice once", () => {
    assert.deepEqual(findMentionedHandles("@alice, and again @alice"), ["alice"]);
  });

  it("normalises, so capitalisation does not make a second person", () => {
    assert.deepEqual(findMentionedHandles("@Alice and @alice"), ["alice"]);
  });

  it("finds nothing in text with no mentions", () => {
    assert.deepEqual(findMentionedHandles("I remember that afternoon"), []);
  });

  it("does not read an email address as a mention", () => {
    // The handle after an `@` in an address belongs to a domain, not a person.
    assert.deepEqual(findMentionedHandles("write to alice@example.com"), []);
  });

  it("ignores something too short to be a handle", () => {
    assert.deepEqual(findMentionedHandles("@ab"), []);
  });

  it("stops at the longest a handle may be", () => {
    const long = "a".repeat(40);

    assert.deepEqual(findMentionedHandles(`@${long}`), [long.slice(0, 30)]);
  });

  it("ignores characters a handle cannot contain", () => {
    assert.deepEqual(findMentionedHandles("@alice-smith"), ["alice"]);
  });

  it("finds one at the very start", () => {
    assert.deepEqual(findMentionedHandles("@alice remember this?"), ["alice"]);
  });
});
