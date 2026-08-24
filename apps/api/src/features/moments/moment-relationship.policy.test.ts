import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { MomentRelationshipKind, Occurrence } from "@chronologity/contracts";
import {
  checkRelationship,
  contradictsKnownTime,
  describeRelationshipRefusal,
  isCausal,
  isSymmetric,
} from "./moment-relationship.policy.js";

const MINE = "me";
const YOURS = "you";
const A = "moment-a";
const B = "moment-b";

const at = (start: string, end: string, precision: Occurrence["precision"]): Occurrence => ({
  start,
  end,
  precision,
});

const INSTANT_2010 = at("2010-01-01T00:00:00.000Z", "2010-01-01T00:00:00.000Z", "instant");
const INSTANT_2020 = at("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", "instant");
const YEAR_1998 = at("1998-01-01T00:00:00.000Z", "1998-12-31T23:59:59.000Z", "year");
const JUNE_1998 = at("1998-06-01T00:00:00.000Z", "1998-06-30T23:59:59.000Z", "month");

const facts = (over: Partial<Parameters<typeof checkRelationship>[3]> = {}) => ({
  asserterUserId: MINE,
  sourceAuthorUserId: MINE,
  targetAuthorUserId: MINE,
  sourceOccurrence: INSTANT_2010,
  targetOccurrence: INSTANT_2020,
  reciprocalCausalExists: false,
  ...over,
});

describe("isCausal", () => {
  it("names the two kinds that claim influence", () => {
    assert.equal(isCausal("led_to"), true);
    assert.equal(isCausal("contributed_to"), true);
  });

  it("does not treat contextual kinds as causal", () => {
    // `causality.md:415`: contextual relationships must never imply causal ones.
    assert.equal(isCausal("related_to"), false);
    assert.equal(isCausal("alternate_perspective"), false);
    assert.equal(isCausal("contradicts"), false);
  });

  it("does not treat an unknown kind as causal", () => {
    assert.equal(isCausal("invented" as MomentRelationshipKind), false);
  });
});

describe("isSymmetric", () => {
  it("names the kinds that read the same from either end", () => {
    assert.equal(isSymmetric("related_to"), true);
    assert.equal(isSymmetric("alternate_perspective"), true);
    assert.equal(isSymmetric("contradicts"), true);
  });

  it("does not treat causal kinds as symmetric", () => {
    assert.equal(isSymmetric("led_to"), false);
    assert.equal(isSymmetric("contributed_to"), false);
  });

  it("does not treat an unknown kind as symmetric", () => {
    assert.equal(isSymmetric("invented" as MomentRelationshipKind), false);
  });
});

describe("contradictsKnownTime", () => {
  it("accepts a cause before its effect", () => {
    assert.equal(contradictsKnownTime(INSTANT_2010, INSTANT_2020), false);
  });

  it("refuses a cause entirely after its effect", () => {
    assert.equal(contradictsKnownTime(INSTANT_2020, INSTANT_2010), true);
  });

  it("accepts a cause during its effect", () => {
    // "A occurred before or during B" is the rule, not "strictly before".
    const during = at("2010-06-01T00:00:00.000Z", "2010-06-02T00:00:00.000Z", "day");
    const spanning = at("2010-01-01T00:00:00.000Z", "2010-12-31T00:00:00.000Z", "year");

    assert.equal(contradictsKnownTime(during, spanning), false);
  });

  it("accepts an order nobody can establish", () => {
    // `causality.md:281`: unknown order is not invalid order. 1998 overlaps
    // June 1998, so Chronologity cannot say which came first and must not
    // pretend otherwise.
    assert.equal(contradictsKnownTime(YEAR_1998, JUNE_1998), false);
    assert.equal(contradictsKnownTime(JUNE_1998, YEAR_1998), false);
  });

  it("accepts two moments at the very same instant", () => {
    assert.equal(contradictsKnownTime(INSTANT_2010, INSTANT_2010), false);
  });
});

describe("checkRelationship", () => {
  it("allows a causal claim within your own history", () => {
    assert.equal(checkRelationship(A, B, "led_to", facts()), undefined);
  });

  it("allows every contextual kind", () => {
    for (const kind of ["related_to", "alternate_perspective", "contradicts"] as const) {
      assert.equal(checkRelationship(A, B, kind, facts()), undefined, kind);
    }
  });

  it("refuses a moment related to itself", () => {
    assert.equal(checkRelationship(A, A, "related_to", facts()), "self_reference");
  });

  it("allows a claim connecting your moment to somebody else's", () => {
    const toTheirs = checkRelationship(A, B, "alternate_perspective", facts({
      targetAuthorUserId: YOURS,
    }));
    const fromTheirs = checkRelationship(A, B, "alternate_perspective", facts({
      sourceAuthorUserId: YOURS,
    }));

    // Either end may be theirs. This is what makes shared history expressible.
    assert.equal(toTheirs, undefined);
    assert.equal(fromTheirs, undefined);
  });

  it("refuses a claim about two moments that are both somebody else's", () => {
    const refusal = checkRelationship(A, B, "related_to", facts({
      sourceAuthorUserId: YOURS,
      targetAuthorUserId: YOURS,
    }));

    assert.equal(refusal, "not_yours");
  });

  it("refuses a cause that happened after its effect", () => {
    const refusal = checkRelationship(A, B, "led_to", facts({
      sourceOccurrence: INSTANT_2020,
      targetOccurrence: INSTANT_2010,
    }));

    assert.equal(refusal, "effect_precedes_cause");
  });

  it("allows a causal claim whose order nobody can establish", () => {
    const refusal = checkRelationship(A, B, "led_to", facts({
      sourceOccurrence: YEAR_1998,
      targetOccurrence: JUNE_1998,
    }));

    assert.equal(refusal, undefined);
  });

  it("applies no temporal rule to a contextual kind", () => {
    const refusal = checkRelationship(A, B, "contradicts", facts({
      sourceOccurrence: INSTANT_2020,
      targetOccurrence: INSTANT_2010,
    }));

    // Two accounts may contradict each other in any order. Only a claim about
    // influence has a direction time can refute.
    assert.equal(refusal, undefined);
  });

  it("refuses a causal claim running back the other way", () => {
    const refusal = checkRelationship(A, B, "led_to", facts({
      reciprocalCausalExists: true,
    }));

    assert.equal(refusal, "reciprocal_cause");
  });

  it("allows a contextual claim even where a causal one runs the other way", () => {
    const refusal = checkRelationship(A, B, "related_to", facts({
      reciprocalCausalExists: true,
    }));

    // Cycle restrictions apply by kind, not across the whole graph
    // (`causality.md:643`).
    assert.equal(refusal, undefined);
  });

  it("refuses a kind it does not recognise", () => {
    const refusal = checkRelationship(A, B, "invented" as MomentRelationshipKind, facts());

    // Default deny. An unrecognised kind must not slip past the causal rules by
    // failing to be causal.
    assert.equal(refusal, "unknown_kind");
  });

  it("refuses ownership before anything else", () => {
    const refusal = checkRelationship(A, B, "led_to", facts({
      sourceAuthorUserId: YOURS,
      targetAuthorUserId: YOURS,
      sourceOccurrence: INSTANT_2020,
      targetOccurrence: INSTANT_2010,
    }));

    // Standing to make the claim is decided before the claim's contents, so a
    // stranger learns nothing about the dates of moments they may not touch.
    assert.equal(refusal, "not_yours");
  });
});

describe("describeRelationshipRefusal", () => {
  it("says something usable for every refusal", () => {
    const reasons = [
      "self_reference",
      "not_yours",
      "effect_precedes_cause",
      "reciprocal_cause",
      "unknown_kind",
    ] as const;

    for (const reason of reasons) {
      assert.ok(describeRelationshipRefusal(reason).length > 10, reason);
    }
  });
});
