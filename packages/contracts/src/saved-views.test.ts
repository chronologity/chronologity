import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import {
  createSavedViewRequestSchema,
  createShareRequestSchema,
  savedViewTitleSchema,
  sharedViewSchema,
} from "./saved-views.js";

/**
 * What a Saved View will and will not accept.
 *
 * Two decisions live in these schemas rather than in any function: what counts
 * as a name, and what a link discloses when nobody said. Both are the kind of
 * thing that is easy to loosen by accident later.
 */

const PERSON = randomUUID();
const context = { type: "person", id: PERSON };

describe("a saved view's title", () => {
  it("is trimmed rather than refused for its whitespace", () => {
    assert.equal(savedViewTitleSchema.parse("  The nineties  "), "The nineties");
  });

  it("refuses one that is only whitespace", () => {
    // After trimming there is nothing left, so this is the empty title arriving
    // by another route.
    assert.equal(savedViewTitleSchema.safeParse("   ").success, false);
  });

  it("refuses an empty one and one longer than a name", () => {
    assert.equal(savedViewTitleSchema.safeParse("").success, false);
    assert.equal(savedViewTitleSchema.safeParse("x".repeat(120)).success, true);
    assert.equal(savedViewTitleSchema.safeParse("x".repeat(121)).success, false);
  });

  it("does not have to be unique", () => {
    // Two views may reasonably both be called "Home". The title is a name, not
    // an identity.
    assert.equal(savedViewTitleSchema.parse("Home"), savedViewTitleSchema.parse("Home"));
  });
});

describe("saving a view", () => {
  it("needs a name and something to point at", () => {
    const parsed = createSavedViewRequestSchema.parse({ title: "Mine", view: { context } });

    assert.equal(parsed.title, "Mine");
    assert.equal(parsed.view.context.id, PERSON);
  });

  it("refuses a specification that is not one", () => {
    assert.equal(
      createSavedViewRequestSchema.safeParse({ title: "Mine", view: { context: { type: "collection", id: PERSON } } })
        .success,
      false,
    );
  });
});

describe("a link to one", () => {
  it("discloses nothing unless the sender said so", () => {
    // The decision that matters here. A title is somebody's words about their
    // own history and a link outlives the conversation it was sent in, so
    // revealing has to be an act rather than a consequence of sharing at all.
    const parsed = createShareRequestSchema.parse({});

    assert.equal(parsed.revealsTitle, false);
    assert.equal(parsed.revealsOwner, false);
  });

  it("takes each choice separately", () => {
    const parsed = createShareRequestSchema.parse({ revealsTitle: true });

    assert.equal(parsed.revealsTitle, true);
    assert.equal(parsed.revealsOwner, false, "one choice decided the other");
  });
});

describe("a shared view as its recipient sees it", () => {
  it("carries a request and nothing that was derived from it", () => {
    // No Moments, no counts, no anything the sender could see and the recipient
    // could not. The reader asks for themselves.
    const parsed = sharedViewSchema.parse({ view: { context } });

    assert.deepEqual(Object.keys(parsed), ["view"]);
  });

  it("cannot name an owner the schema does not know", () => {
    assert.equal(sharedViewSchema.safeParse({ view: { context }, owner: { userId: PERSON } }).success, false);
  });
});
