import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { eligible } from "./eligibility.js";

/**
 * The rule deciding what a Viewer may be shown.
 *
 * It is a string, so what can be tested here is what it says rather than what
 * it returns — whether the rows it admits are the right ones is proved against
 * a real ClickHouse in the API's integration suite.
 *
 * That is still worth testing, because every one of these clauses was added in
 * response to something: a Moment shown at a place after moderation took it
 * down, a suspended account's history still appearing under a Location. A
 * clause silently dropped in an edit would put one of those back, and nothing
 * else in the unit suites would notice.
 */

const RULE = eligible("rows");

describe("eligible", () => {
  it("writes every condition against the alias it is given", () => {
    const other = eligible("timeline_moment_contexts");

    assert.ok(!RULE.includes("timeline_moment_contexts."));
    assert.ok(other.includes("timeline_moment_contexts.author_user_id"));
    assert.ok(!other.includes("rows."));
  });

  it("admits a Viewer's own history unconditionally", () => {
    // First clause, and deliberately outside everything else: somebody must be
    // able to navigate their own past even where nobody else may, including
    // when they are suspended and appealing it.
    assert.match(RULE, /rows\.author_user_id = \{viewer: String\}\s*\n\s*OR/);
  });

  it("withholds history by a suspended author", () => {
    assert.match(
      RULE,
      /NOT IN \(\s*SELECT user_id FROM timeline_suspended_authors WHERE suspended = 1/,
    );
  });

  it("withholds history by somebody the Viewer is separated from", () => {
    assert.match(RULE, /NOT has\(\{blocked: Array\(String\)\}, rows\.author_user_id\)/);
  });

  it("admits a public Moment, or a restricted one naming the Viewer", () => {
    assert.match(RULE, /rows\.visibility = 'public'/);
    assert.match(RULE, /has\(\{audience: Array\(String\)\}, rows\.moment_id\)/);
  });

  it("withholds age-restricted history from somebody who is not an adult", () => {
    assert.match(RULE, /moderation_state != 'age_restricted' OR \{isAdult: UInt8\} = 1/);
  });

  it("withholds a Moment taken down pending a decision", () => {
    // The clause whose absence was a leak rather than a redundancy: a public
    // Moment taken down went on being shown to strangers at the place it
    // happened.
    assert.match(RULE, /moderation_state != 'temporarily_unavailable'/);
  });

  it("keeps the takedown clause outside the visibility branch", () => {
    // Inside it, the branch is satisfied by being public *or* by naming the
    // Viewer — so the rule would withhold a public Moment and show a restricted
    // one to the very person it named.
    const takedown = RULE.indexOf("temporarily_unavailable");
    const audience = RULE.indexOf("audience: Array(String)");

    assert.ok(audience !== -1 && takedown > audience);
    assert.match(RULE.slice(audience, takedown), /\)\s*\n\s*AND/);
  });

  it("names all four parameters a caller has to bind", () => {
    // There is no variant that omits one. A caller who forgot would otherwise
    // get somebody else's history rather than an error.
    for (const parameter of [
      "{viewer: String}",
      "{blocked: Array(String)}",
      "{audience: Array(String)}",
      "{isAdult: UInt8}",
    ]) {
      assert.ok(RULE.includes(parameter), `${parameter} is not bound`);
    }
  });
});
