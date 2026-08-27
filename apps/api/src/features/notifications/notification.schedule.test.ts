import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { dueAt, usableZone, type DeliverySchedule } from "./notification.schedule.js";

const immediately: DeliverySchedule = { mode: "immediate", digestHour: 9, quiet: undefined };

const digestAt = (digestHour: number): DeliverySchedule => ({
  mode: "digest",
  digestHour,
  quiet: undefined,
});

const quietFrom = (from: number, until: number): DeliverySchedule => ({
  mode: "immediate",
  digestHour: 9,
  quiet: { from, until },
});

const at = (iso: string): Date => new Date(iso);
const when = (result: Date): string => result.toISOString();

describe("dueAt without any rule to apply", () => {
  it("delivers when the activity happened", () => {
    assert.equal(
      when(dueAt(at("2026-06-10T12:34:56Z"), "ordinary", immediately, "UTC")),
      "2026-06-10T12:34:56.000Z",
    );
  });

  it("never moves a delivery earlier", () => {
    const activity = at("2026-06-10T23:00:00Z");

    for (const urgency of ["immediate", "prompt", "ordinary"] as const) {
      for (const schedule of [immediately, digestAt(9), quietFrom(22, 7), quietFrom(1, 5)]) {
        assert.ok(
          dueAt(activity, urgency, schedule, "Europe/London").getTime() >= activity.getTime(),
          `${urgency} ${schedule.mode}`,
        );
      }
    }
  });
});

describe("dueAt for something that waits for nothing", () => {
  it("delivers inside quiet hours anyway", () => {
    // The one category that is worth waking somebody for. By morning the
    // account may be gone.
    assert.equal(
      when(dueAt(at("2026-06-10T23:00:00Z"), "immediate", quietFrom(22, 7), "UTC")),
      "2026-06-10T23:00:00.000Z",
    );
  });

  it("is never held for a digest", () => {
    assert.equal(
      when(dueAt(at("2026-06-10T12:00:00Z"), "immediate", digestAt(9), "UTC")),
      "2026-06-10T12:00:00.000Z",
    );
  });
});

describe("dueAt for something that must not wait for a digest", () => {
  it("ignores the digest hour", () => {
    assert.equal(
      when(dueAt(at("2026-06-10T12:00:00Z"), "prompt", digestAt(9), "UTC")),
      "2026-06-10T12:00:00.000Z",
    );
  });

  it("still waits out a quiet window", () => {
    // A moderation decision will still be there at eight, and appealing it is
    // no more possible at three.
    assert.equal(
      when(dueAt(at("2026-06-10T23:00:00Z"), "prompt", quietFrom(22, 7), "UTC")),
      "2026-06-11T07:00:00.000Z",
    );
  });
});

describe("dueAt with a digest", () => {
  it("uses today's digest hour when it is still ahead", () => {
    assert.equal(
      when(dueAt(at("2026-06-10T06:00:00Z"), "ordinary", digestAt(9), "UTC")),
      "2026-06-10T09:00:00.000Z",
    );
  });

  it("uses tomorrow's when today's has passed", () => {
    assert.equal(
      when(dueAt(at("2026-06-10T14:00:00Z"), "ordinary", digestAt(9), "UTC")),
      "2026-06-11T09:00:00.000Z",
    );
  });

  it("treats a digest hour arriving this instant as arrived", () => {
    // Otherwise a notification created at exactly nine would be scheduled for
    // an instant the dispatcher has already walked past.
    assert.equal(
      when(dueAt(at("2026-06-10T09:00:00Z"), "ordinary", digestAt(9), "UTC")),
      "2026-06-11T09:00:00.000Z",
    );
  });

  it("pushes a digest hour that falls inside quiet hours to the end of them", () => {
    // The ordering: the digest is computed first and the quiet window applied
    // over it. Somebody who sets a three o'clock digest and quiet hours until
    // five has asked for two things that disagree, and the quiet window wins.
    assert.equal(
      when(
        dueAt(
          at("2026-06-10T12:00:00Z"),
          "ordinary",
          { mode: "digest", digestHour: 3, quiet: { from: 1, until: 5 } },
          "UTC",
        ),
      ),
      "2026-06-11T05:00:00.000Z",
    );
  });
});

describe("dueAt at the edges of a quiet window", () => {
  it("treats the opening hour as quiet", () => {
    assert.equal(
      when(dueAt(at("2026-06-11T01:00:00Z"), "ordinary", quietFrom(1, 5), "UTC")),
      "2026-06-11T05:00:00.000Z",
    );
  });

  it("treats the closing hour as no longer quiet", () => {
    assert.equal(
      when(dueAt(at("2026-06-11T05:00:00Z"), "ordinary", quietFrom(1, 5), "UTC")),
      "2026-06-11T05:00:00.000Z",
    );
  });

  it("leaves the minute before the window alone", () => {
    assert.equal(
      when(dueAt(at("2026-06-11T00:59:00Z"), "ordinary", quietFrom(1, 5), "UTC")),
      "2026-06-11T00:59:00.000Z",
    );
  });

  it("leaves the last minute of the window inside it", () => {
    assert.equal(
      when(dueAt(at("2026-06-11T04:59:00Z"), "ordinary", quietFrom(1, 5), "UTC")),
      "2026-06-11T05:00:00.000Z",
    );
  });
});

describe("dueAt with a quiet window that wraps past midnight", () => {
  it("delivers the following morning when the evening is quiet", () => {
    // The ordinary case: quiet hours nearly always run from an evening into a
    // morning, so a comparison handling only `from < until` would be wrong for
    // almost everybody who sets them.
    assert.equal(
      when(dueAt(at("2026-06-10T23:00:00Z"), "ordinary", quietFrom(22, 7), "UTC")),
      "2026-06-11T07:00:00.000Z",
    );
  });

  it("delivers the same morning when the small hours are quiet", () => {
    assert.equal(
      when(dueAt(at("2026-06-11T03:00:00Z"), "ordinary", quietFrom(22, 7), "UTC")),
      "2026-06-11T07:00:00.000Z",
    );
  });

  it("leaves the middle of the day alone", () => {
    assert.equal(
      when(dueAt(at("2026-06-11T12:00:00Z"), "ordinary", quietFrom(22, 7), "UTC")),
      "2026-06-11T12:00:00.000Z",
    );
  });
});

describe("dueAt in a zone that is not UTC", () => {
  it("reads quiet hours as local hours", () => {
    // 23:00 in London is 22:00 UTC in June. A quiet window read against UTC
    // would find this outside itself and deliver at once.
    assert.equal(
      when(dueAt(at("2026-06-10T22:00:00Z"), "ordinary", quietFrom(22, 7), "Europe/London")),
      "2026-06-11T06:00:00.000Z",
    );
  });

  it("reads a digest hour as a local hour", () => {
    assert.equal(
      when(dueAt(at("2026-03-27T12:00:00Z"), "ordinary", digestAt(9), "Europe/London")),
      "2026-03-28T09:00:00.000Z",
    );
  });
});

describe("dueAt on the day clocks move", () => {
  it("keeps a digest at nine when the clocks go forward", () => {
    // 29 March 2026: British Summer Time begins at 01:00 UTC. Nine o'clock
    // local is an hour earlier in UTC than it was the day before, and the
    // arithmetic has to notice — adding twenty-four hours to yesterday's
    // instant would deliver at ten.
    assert.equal(
      when(dueAt(at("2026-03-28T12:00:00Z"), "ordinary", digestAt(9), "Europe/London")),
      "2026-03-29T08:00:00.000Z",
    );
  });

  it("keeps a digest at nine when the clocks go back", () => {
    // 25 October 2026, the other direction.
    assert.equal(
      when(dueAt(at("2026-10-24T12:00:00Z"), "ordinary", digestAt(9), "Europe/London")),
      "2026-10-25T09:00:00.000Z",
    );
  });

  it("keeps a digest at nine across an American spring transition", () => {
    // A different date from Europe's, and a different offset either side, so
    // this fails for anything that has hard-coded one zone's rules.
    assert.equal(
      when(dueAt(at("2026-03-07T18:00:00Z"), "ordinary", digestAt(9), "America/New_York")),
      "2026-03-08T13:00:00.000Z",
    );
  });

  it("keeps a digest at nine across an American autumn transition", () => {
    assert.equal(
      when(dueAt(at("2026-10-31T18:00:00Z"), "ordinary", digestAt(9), "America/New_York")),
      "2026-11-01T14:00:00.000Z",
    );
  });

  it("resolves a quiet window ending in the hour that never happens", () => {
    // Quiet until one o'clock, on the night one o'clock is skipped. The answer
    // is the instant just after the gap, which is the first moment that hour
    // can be said to have arrived — and, importantly, not an hour in the past
    // and not a day later.
    assert.equal(
      when(dueAt(at("2026-03-28T23:30:00Z"), "ordinary", quietFrom(22, 1), "Europe/London")),
      "2026-03-29T01:00:00.000Z",
    );
  });

  it("resolves a quiet window ending in the hour that happens twice", () => {
    // The other transition, where one o'clock comes round twice. The second is
    // taken, so the window ends an hour later than on an ordinary night rather
    // than an hour earlier — erring towards quiet.
    assert.equal(
      when(dueAt(at("2026-10-24T22:30:00Z"), "ordinary", quietFrom(22, 1), "Europe/London")),
      "2026-10-25T01:00:00.000Z",
    );
  });
});

describe("usableZone", () => {
  it("keeps a zone the runtime knows", () => {
    assert.equal(usableZone("Europe/London"), "Europe/London");
    assert.equal(usableZone("Australia/Eucla"), "Australia/Eucla");
  });

  it("falls back to UTC for one it does not", () => {
    // A stored preference is untrusted by the time the dispatcher reads it.
    // Throwing here would mean no delivery is ever scheduled, and for a
    // security notification silence is the failure that matters.
    assert.equal(usableZone("Mars/Olympus"), "UTC");
    assert.equal(usableZone(""), "UTC");
  });

  it("schedules against UTC when the zone is unusable", () => {
    assert.equal(
      when(dueAt(at("2026-06-10T23:00:00Z"), "ordinary", quietFrom(22, 7), "Mars/Olympus")),
      "2026-06-11T07:00:00.000Z",
    );
  });
});

describe("dueAt in a zone with a half-hour offset", () => {
  it("still reads the local hour", () => {
    // 18:00 UTC is 23:30 in Kolkata. A zone whose offset is not a whole number
    // of hours is where an implementation that divides by 3,600,000 goes wrong.
    assert.equal(
      when(dueAt(at("2026-06-10T18:00:00Z"), "ordinary", quietFrom(22, 7), "Asia/Kolkata")),
      "2026-06-11T01:30:00.000Z",
    );
  });
});
