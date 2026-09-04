import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { realWorldEventVisibleTo } from "./event-access.js";
import { moderationPermits, privacyPermits } from "./moment-access.js";
import { NAMED_VIEWER, PositionalParameters } from "./placeholders.js";

/**
 * Whether somebody may know a real-world Event exists.
 *
 * The property worth protecting here is that this rule **delegates** rather than
 * restating. An Event's visibility is "you can read a Moment in it", and the
 * moment somebody hand-inlines what that means, the two definitions start
 * drifting — with an Event surviving a rule change that its Moments did not.
 */

const named = (): string => realWorldEventVisibleTo("e", NAMED_VIEWER);

describe("what the rule asks", () => {
  it("admits the creator before anything else", () => {
    // Provenance, never ownership: you may read the record you caused to exist.
    // Without it, recording an Event and reading it back would answer nothing
    // until somebody attached a Moment to it.
    assert.match(named(), /^\(\s*e\.created_by_user_id = :viewerUserId\s*OR/);
  });

  it("otherwise asks whether any Moment in it can be read", () => {
    assert.ok(named().includes("FROM moment_real_world_events mre"));
    assert.ok(named().includes("JOIN moments m ON m.moment_id = mre.moment_id"));
    assert.ok(named().includes("mre.real_world_event_id = e.real_world_event_id"));
  });

  it("ignores a Moment that has been deleted", () => {
    assert.ok(named().includes("m.deleted_at IS NULL"));
  });

  it("delegates to the Moment rule rather than restating any of it", () => {
    // The assertion that matters. If somebody ever inlines the visibility
    // checks here, an Event stops inheriting changes to the rule its own
    // visibility is defined in terms of — and it does so silently.
    const composed = named();

    assert.ok(composed.includes(privacyPermits("m", NAMED_VIEWER)));
    assert.ok(composed.includes(moderationPermits("m", NAMED_VIEWER)));
  });

  it("asks nothing an Event could answer for itself", () => {
    // There is no visibility column and there should not be: an Event belongs
    // to nobody, so there is nobody whose setting it would be.
    for (const absent of ["e.visibility", "e.is_public", "e.private"]) {
      assert.ok(!named().includes(absent), `the rule read ${absent}`);
    }
  });

  it("reads the Event table under the alias it is given", () => {
    // Checked on the columns rather than on the bare prefix: the rule joins
    // `mre`, and "e." is a substring of that.
    const renamed = realWorldEventVisibleTo("other", NAMED_VIEWER);

    assert.ok(renamed.includes("other.created_by_user_id"));
    assert.ok(renamed.includes("other.real_world_event_id"));
    assert.ok(!renamed.includes("e.created_by_user_id"));
  });
});

describe("the dialects", () => {
  it("renders positionally without a colon anywhere", () => {
    const bind = new PositionalParameters();
    const sql = realWorldEventVisibleTo("e", {
      viewerUserId: bind.bind("somebody"),
      viewerIsAdult: bind.bind(true),
    });

    assert.ok(sql.includes("$1"));
    assert.ok(sql.includes("$2"));
    assert.ok(!sql.includes(":viewerUserId"));
    assert.deepEqual(bind.values, ["somebody", true]);
  });

  it("emits no placeholder the caller did not supply", () => {
    const sql = realWorldEventVisibleTo("e", {
      viewerUserId: "@@viewer@@",
      viewerIsAdult: "@@adult@@",
    });

    assert.ok(!sql.includes("$"));
    assert.ok(!/:[a-zA-Z]/.test(sql));
  });
});
