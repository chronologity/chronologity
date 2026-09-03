import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { moderationPermits, privacyPermits, visibleToViewer } from "./moment-access.js";
import { NAMED_VIEWER, PositionalParameters } from "./placeholders.js";

/**
 * Whether a Viewer may see a Moment.
 *
 * The rule that leaks when it is wrong, which is why it exists once. These
 * assertions are about what the text says rather than what a database does with
 * it — a query against real rows is the only thing that proves behaviour, and
 * the applications' integration suites do that. What is proved here is that
 * every clause the policy names is present, that neither half asks for more than
 * it needs, and that no placeholder appears which the caller did not supply.
 */

const privacy = (): string => privacyPermits("moment", NAMED_VIEWER);
const moderation = (): string => moderationPermits("moment", NAMED_VIEWER);

describe("the privacy half", () => {
  it("admits the author before anything else", () => {
    // Ordered as the policy is. A Block cannot be outlived by an invitation
    // issued before it, and nobody is shut out of their own history.
    assert.match(privacy(), /^\(\s*moment\.author_user_id = :viewerUserId\s*OR/);
  });

  it("separates two people by a Block in either direction", () => {
    // Asymmetry would let the blocked person infer the Block from history that
    // stopped appearing one way only.
    assert.ok(privacy().includes("b.blocker_user_id = moment.author_user_id"));
    assert.ok(privacy().includes("b.blocker_user_id = :viewerUserId"));
  });

  it("admits a public Moment, or one whose audience names the Viewer", () => {
    assert.ok(privacy().includes("moment.visibility = 'public'"));
    assert.ok(privacy().includes("FROM moment_audience a"));
  });

  it("says nothing about private or restricted by name", () => {
    // It requires public or an audience row, so private fails by having none.
    // Naming the values as well would be a second statement of the rule.
    assert.ok(!privacy().includes("'private'"));
    assert.ok(!privacy().includes("'restricted'"));
  });

  it("never asks about age", () => {
    // The property the relationship read depends on. Privacy decides whether a
    // far end is mentioned at all; moderation decides whether it is a tombstone.
    // An age check leaking in here would omit a Moment that should have been
    // marked unavailable, and would do it silently.
    assert.ok(!privacy().includes("viewerIsAdult"));
  });
});

describe("the moderation half", () => {
  it("admits the author before anything else", () => {
    // Somebody who cannot see what was hidden cannot meaningfully appeal it.
    assert.match(moderation(), /^\(\s*moment\.author_user_id = :viewerUserId\s*OR/);
  });

  it("withholds a suspended author's history from everybody else", () => {
    assert.ok(moderation().includes("author.status = 'suspended'"));
  });

  it("withholds what was removed or taken down pending a decision", () => {
    assert.ok(moderation().includes("ms.state IN ('removed', 'temporarily_unavailable')"));
  });

  it("gates age-restricted history on the Viewer's age", () => {
    assert.ok(moderation().includes("ms.state = 'age_restricted' AND NOT :viewerIsAdult"));
  });

  it("narrows to the audience when moderation says so, not only when the author did", () => {
    assert.ok(moderation().includes("ms.state = 'restricted_to_authorized_audience'"));
  });

  it("leaves out the states that hide nothing from a direct reader", () => {
    // `warned` and `restricted_from_amplification` are about promotion, which
    // the surfaces that amplify enforce. Including them here would hide a
    // Moment from somebody who asked for it by name.
    assert.ok(!moderation().includes("warned"));
    assert.ok(!moderation().includes("restricted_from_amplification"));
  });
});

describe("the whole rule", () => {
  it("is both halves, and withholds when either does", () => {
    assert.equal(
      visibleToViewer("moment", NAMED_VIEWER),
      `(${privacy()} AND ${moderation()})`,
    );
  });

  it("reads the Moment table under the alias it is given", () => {
    // Reading the far end of a relationship joins the Moment table twice, so a
    // hardcoded alias would compare a Moment against itself.
    assert.ok(!visibleToViewer("other", NAMED_VIEWER).includes("moment."));
    assert.ok(visibleToViewer("other", NAMED_VIEWER).includes("other.author_user_id"));
  });
});

describe("the dialects", () => {
  it("renders positionally, with each fact numbered once and reused", () => {
    const bind = new PositionalParameters();
    const viewer = {
      viewerUserId: bind.bind("somebody"),
      viewerIsAdult: bind.bind(true),
    };
    const sql = visibleToViewer("m", viewer);

    assert.deepEqual(bind.values, ["somebody", true]);
    assert.ok(sql.includes("$1"));
    assert.ok(sql.includes("$2"));
    assert.ok(!sql.includes(":viewerUserId"));
  });

  it("emits no placeholder the caller did not supply", () => {
    // What makes one rule safe for two clients: every hole in the text came
    // from the caller, so neither dialect can leak into the other.
    const sql = visibleToViewer("m", {
      viewerUserId: "@@viewer@@",
      viewerIsAdult: "@@adult@@",
    });

    assert.ok(!sql.includes("$"));
    assert.ok(!/:[a-zA-Z]/.test(sql));
  });

  it("renders the same rule either way, differing only in its tokens", () => {
    const positional = visibleToViewer("m", {
      viewerUserId: ":viewerUserId",
      viewerIsAdult: ":viewerIsAdult",
    });

    assert.equal(positional, visibleToViewer("m", NAMED_VIEWER));
  });
});
