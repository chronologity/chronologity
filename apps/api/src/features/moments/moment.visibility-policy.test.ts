import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ModerationState, MomentVisibility } from "@chronologity/contracts";
import { checkVisibility } from "./moment.visibility-policy.js";

const AUTHOR = "author";
const STRANGER = "stranger";

const moment = (visibility: MomentVisibility, authorUserId = AUTHOR) => ({
  authorUserId,
  visibility,
});

const facts = (
  over: {
    blockedEitherWay?: boolean;
    inAudience?: boolean;
    authorSuspended?: boolean;
    moderationState?: ModerationState;
    viewerIsAdult?: boolean;
  } = {},
) => ({
  blockedEitherWay: over.blockedEitherWay ?? false,
  inAudience: over.inAudience ?? false,
  authorSuspended: over.authorSuspended ?? false,
  moderationState: over.moderationState,
  viewerIsAdult: over.viewerIsAdult ?? true,
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

  it("refuses a stranger a removed Moment", () => {
    const refusal = checkVisibility(STRANGER, moment("public"), facts({ moderationState: "removed" }));

    assert.equal(refusal, "moderated");
  });

  it("refuses a stranger a Moment withheld during review", () => {
    const refusal = checkVisibility(
      STRANGER,
      moment("public"),
      facts({ moderationState: "temporarily_unavailable" }),
    );

    assert.equal(refusal, "moderated");
  });

  it("lets the author see their own removed Moment", () => {
    const refusal = checkVisibility(AUTHOR, moment("public"), facts({ moderationState: "removed" }));

    // What makes an appeal possible. Somebody who cannot see what was hidden
    // cannot meaningfully contest it.
    assert.equal(refusal, undefined);
  });

  it("lets the author see their own Moment while they are suspended", () => {
    const refusal = checkVisibility(AUTHOR, moment("public"), facts({ authorSuspended: true }));

    assert.equal(refusal, undefined);
  });

  it("refuses a stranger a Moment by a suspended author", () => {
    const refusal = checkVisibility(STRANGER, moment("public"), facts({ authorSuspended: true }));

    assert.equal(refusal, "author_suspended");
  });

  it("refuses somebody under eighteen an age-restricted Moment", () => {
    const refusal = checkVisibility(
      STRANGER,
      moment("public"),
      facts({ moderationState: "age_restricted", viewerIsAdult: false }),
    );

    assert.equal(refusal, "too_young");
  });

  it("lets an adult see an age-restricted Moment", () => {
    const refusal = checkVisibility(
      STRANGER,
      moment("public"),
      facts({ moderationState: "age_restricted", viewerIsAdult: true }),
    );

    assert.equal(refusal, undefined);
  });

  it("narrows a public Moment to its audience when moderation says so", () => {
    const refusal = checkVisibility(
      STRANGER,
      moment("public"),
      facts({ moderationState: "restricted_to_authorized_audience", inAudience: false }),
    );

    // Overrides the author's own choice rather than deferring to it: the state
    // exists precisely for something meant for everybody that Chronologity has
    // decided should reach fewer people.
    assert.equal(refusal, "not_in_audience");
  });

  it("admits somebody on the list to a narrowed Moment", () => {
    const refusal = checkVisibility(
      STRANGER,
      moment("public"),
      facts({ moderationState: "restricted_to_authorized_audience", inAudience: true }),
    );

    assert.equal(refusal, undefined);
  });

  it("hides nothing when a Moment only carries a warning", () => {
    const refusal = checkVisibility(STRANGER, moment("public"), facts({ moderationState: "warned" }));

    assert.equal(refusal, undefined);
  });

  it("hides nothing when a Moment is only kept out of amplification", () => {
    const refusal = checkVisibility(
      STRANGER,
      moment("public"),
      facts({ moderationState: "restricted_from_amplification" }),
    );

    // Allowed to be accessed directly, not eligible for Discovery or broad
    // Search — the line `moderation.md:211` draws.
    assert.equal(refusal, undefined);
  });

  it("refuses a stranger a Moment in a state it does not recognise", () => {
    const refusal = checkVisibility(
      STRANGER,
      moment("public"),
      facts({ moderationState: "confiscated" as ModerationState }),
    );

    assert.equal(refusal, "moderated");
  });

  it("refuses a suspended author's Moment before consulting its moderation state", () => {
    const refusal = checkVisibility(
      STRANGER,
      moment("public"),
      facts({ authorSuspended: true, moderationState: "warned" }),
    );

    assert.equal(refusal, "author_suspended");
  });

  it("refuses a blocked Viewer before consulting suspension", () => {
    const refusal = checkVisibility(
      STRANGER,
      moment("public"),
      facts({ blockedEitherWay: true, authorSuspended: true }),
    );

    assert.equal(refusal, "blocked");
  });
});
