import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  cutoff,
  RETENTION_SCHEDULE,
  type RetentionPeriod,
  type RetentionRule,
} from "./retention.policy.js";

const at = new Date("2026-06-10T12:00:00Z");

const ruleNamed = (name: string): RetentionRule => {
  const found = RETENTION_SCHEDULE.find((rule) => rule.name === name);

  assert.notEqual(found, undefined, name);

  return found as RetentionRule;
};

describe("cutoff", () => {
  it("measures back from the instant given", () => {
    assert.equal(cutoff(at, 30).toISOString(), "2026-05-11T12:00:00.000Z");
  });

  it("treats a period of zero as the instant itself", () => {
    // A deployment that wants nothing retained can say so, and the tests use it
    // to watch a guard fail.
    assert.equal(cutoff(at, 0).toISOString(), at.toISOString());
  });

  it("refuses a negative period", () => {
    // A cutoff in the future sweeps rows that have not aged at all. That is not
    // a retention policy, and it should be impossible to configure by accident.
    assert.throws(() => cutoff(at, -1), RangeError);
  });
});

describe("the schedule", () => {
  it("gives every rule a table, a column, a predicate, and a period", () => {
    for (const rule of RETENTION_SCHEDULE) {
      assert.ok(rule.name.length > 0, "name");
      assert.ok(rule.table.length > 0, rule.name);
      assert.ok(rule.column.length > 0, rule.name);
      assert.ok(rule.where.length > 0, rule.name);
      assert.ok(rule.period.length > 0, rule.name);
    }
  });

  it("names each rule once", () => {
    const names = RETENTION_SCHEDULE.map((rule) => rule.name);

    assert.equal(new Set(names).size, names.length);
  });

  it("describes no rule twice", () => {
    // Two rules with the same table, column and predicate would sweep the same
    // rows on two schedules, and whichever ran first would decide.
    const shapes = RETENTION_SCHEDULE.map(
      (rule) => `${rule.table}|${rule.column}|${rule.where}`,
    );

    assert.equal(new Set(shapes).size, shapes.length);
  });

  it("touches nothing anybody recorded", () => {
    // The claim of this sub-phase, stated where it can be checked rather than
    // only asserted against a database. A product built to preserve decades
    // does not expire the decades; what it expires is the exhaust.
    const history = [
      "moments",
      "moment_media",
      "moment_comments",
      "moment_reactions",
      "moment_audience",
      "moment_edits",
      "moment_locations",
      "moment_real_world_events",
      "moment_relationships",
      "moment_personal_significance",
      "locations",
      "real_world_events",
      "uploads",
      "users",
      "user_handles",
      "moderation_reports",
      "moderation_appeals",
      "moderation_actions",
      "moderation_states",
      "accuracy_reports",
      "comment_reactions",
      "comment_mentions",
      "user_follows",
      "user_blocks",
    ];

    for (const rule of RETENTION_SCHEDULE) {
      assert.equal(history.includes(rule.table), false, `${rule.name} sweeps ${rule.table}`);
    }
  });

  it("keeps a required notification longest", () => {
    // A moderation notification carries a right of appeal and a security one is
    // the record that an account changed. Both must outlive an ordinary one.
    assert.equal(ruleNamed("required notifications").period, "requiredNotifications");
    assert.equal(ruleNamed("ordinary notifications").period, "notifications");
    assert.equal(ruleNamed("read notifications").period, "readNotifications");
  });

  it("judges a read notification by when it was read and an unread one by its age", () => {
    // An unread notification is something somebody has not seen, so its age is
    // what matters; a read one is finished with, so the reading is.
    assert.equal(ruleNamed("read notifications").column, "read_at");
    assert.equal(ruleNamed("ordinary notifications").column, "created_at");
    assert.equal(ruleNamed("read notifications").table, "notifications");
    assert.equal(ruleNamed("ordinary notifications").table, "notifications");
  });

  it("retires a dormant device rather than removing it", () => {
    // The retired row is what distinguishes a dead token from one that was
    // never registered, so it has to exist for a while after the device stops
    // being pushed at.
    assert.equal(ruleNamed("dormant devices").action, "retire");
    assert.equal(ruleNamed("retired devices").action, "remove");
  });

  it("removes rows in every other rule", () => {
    for (const rule of RETENTION_SCHEDULE) {
      if (rule.name !== "dormant devices") {
        assert.equal(rule.action, "remove", rule.name);
      }
    }
  });

  it("sweeps only finished work in the tables that queue it", () => {
    for (const name of ["delivery records", "finished erasures", "finished exports"]) {
      assert.match(ruleNamed(name).where, /<> 'pending'/, name);
    }
  });

  it("sweeps the deduplication table, which nothing cascades to", () => {
    // It references `users` and not `notifications`, so every notification
    // sweep leaves it untouched and it would otherwise grow without limit.
    assert.equal(ruleNamed("notification deduplication").table, "notification_source_events");
  });

  it("uses every period it declares", () => {
    // A period nothing uses is one somebody configured expecting an effect.
    const declared: RetentionPeriod[] = [
      "signInArtefacts",
      "readNotifications",
      "notifications",
      "requiredNotifications",
      "notificationDeduplication",
      "deliveryRecords",
      "dormantDevices",
      "retiredDevices",
      "auditEvents",
      "privacyRequests",
    ];
    const used = new Set(RETENTION_SCHEDULE.map((rule) => rule.period));

    assert.deepEqual([...declared].filter((period) => !used.has(period)), []);
  });
});
