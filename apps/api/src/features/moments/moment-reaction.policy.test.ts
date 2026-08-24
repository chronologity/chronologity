import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ReactionKind } from "@chronologity/contracts";
import {
  checkReaction,
  describeReactionRefusal,
  isReactionKind,
} from "./moment-reaction.policy.js";

const facts = (over: { reactionsEnabled?: boolean; blockedEitherWay?: boolean } = {}) => ({
  reactionsEnabled: over.reactionsEnabled ?? true,
  blockedEitherWay: over.blockedEitherWay ?? false,
});

describe("isReactionKind", () => {
  it("recognises the four that ship", () => {
    for (const kind of ["loved", "amused", "astonished", "saddened"] as const) {
      assert.equal(isReactionKind(kind), true, kind);
    }
  });

  it("does not recognise anything else", () => {
    assert.equal(isReactionKind("furious" as ReactionKind), false);
  });
});

describe("checkReaction", () => {
  it("permits every kind on a Moment accepting them", () => {
    for (const kind of ["loved", "amused", "astonished", "saddened"] as const) {
      assert.equal(checkReaction(kind, facts()), undefined, kind);
    }
  });

  it("refuses when the Moment is not accepting reactions", () => {
    assert.equal(checkReaction("loved", facts({ reactionsEnabled: false })), "reactions_disabled");
  });

  it("refuses when a block separates the two people", () => {
    assert.equal(checkReaction("loved", facts({ blockedEitherWay: true })), "blocked");
  });

  it("answers blocking before the Moment's own setting", () => {
    const refusal = checkReaction("loved", facts({ blockedEitherWay: true, reactionsEnabled: false }));

    // A Block is a safety boundary; an author's interaction preference is not.
    // Reversing them would let a blocked person learn whether reactions were
    // enabled, which is more than they should learn about somebody who wants
    // nothing to do with them.
    assert.equal(refusal, "blocked");
  });

  it("refuses a kind it does not recognise", () => {
    assert.equal(checkReaction("furious" as ReactionKind, facts()), "unknown_kind");
  });
});

describe("describeReactionRefusal", () => {
  it("never says that somebody has been blocked", () => {
    const blocked = describeReactionRefusal("blocked");
    const disabled = describeReactionRefusal("reactions_disabled");

    // Telling somebody they have been blocked is precisely what the product
    // must not do, so the two are one sentence.
    assert.equal(blocked, disabled);
    assert.doesNotMatch(blocked, /block/i);
  });

  it("says something usable for every refusal", () => {
    for (const reason of ["blocked", "reactions_disabled", "unknown_kind"] as const) {
      assert.ok(describeReactionRefusal(reason).length > 10, reason);
    }
  });
});
