import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { MomentVisibility } from "@chronologity/contracts";
import { checkVisibility } from "./moment.visibility-policy.js";

const AUTHOR = "author";
const STRANGER = "stranger";

const moment = (visibility: MomentVisibility, authorUserId = AUTHOR) => ({
  authorUserId,
  visibility,
});

const facts = (over: { blockedEitherWay?: boolean; inAudience?: boolean } = {}) => ({
  blockedEitherWay: over.blockedEitherWay ?? false,
  inAudience: over.inAudience ?? false,
});

describe("checkVisibility", () => {
  it("lets the author see their own private Moment", () => {
    assert.equal(checkVisibility(AUTHOR, moment("private"), facts()), undefined);
  });

  it("lets the author see their own Moment even where a block separates them", () => {
    const refusal = checkVisibility(AUTHOR, moment("private"), facts({ blockedEitherWay: true }));

    assert.equal(refusal, undefined);
  });

  it("lets a stranger see a public Moment", () => {
    assert.equal(checkVisibility(STRANGER, moment("public"), facts()), undefined);
  });

  it("refuses a stranger a private Moment", () => {
    assert.equal(checkVisibility(STRANGER, moment("private"), facts()), "private");
  });

  it("lets somebody on the list see a restricted Moment", () => {
    const refusal = checkVisibility(STRANGER, moment("restricted"), facts({ inAudience: true }));

    assert.equal(refusal, undefined);
  });

  it("refuses somebody off the list a restricted Moment", () => {
    const refusal = checkVisibility(STRANGER, moment("restricted"), facts({ inAudience: false }));

    assert.equal(refusal, "not_in_audience");
  });

  it("refuses a public Moment where a block separates the two", () => {
    const refusal = checkVisibility(
      STRANGER,
      moment("public"),
      facts({ blockedEitherWay: true }),
    );

    assert.equal(refusal, "blocked");
  });

  it("refuses a restricted Moment to somebody on the list once a block separates them", () => {
    const refusal = checkVisibility(
      STRANGER,
      moment("restricted"),
      facts({ blockedEitherWay: true, inAudience: true }),
    );

    // Blocking is decided before the list, so a block cannot be outlived by an
    // invitation issued before it.
    assert.equal(refusal, "blocked");
  });

  it("refuses a visibility it does not recognise", () => {
    const refusal = checkVisibility(
      STRANGER,
      moment("hyperbolic" as MomentVisibility),
      facts(),
    );

    // Default deny. A widened column constraint that forgot this rule should
    // fail here rather than publish somebody's history.
    assert.equal(refusal, "unknown_visibility");
  });
});
