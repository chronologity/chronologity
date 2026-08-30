import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { readPrecision, timelineRowFor } from "./timeline-projection.js";
import type { TimelineSource } from "./timeline-source.repository.js";

const source = (over: Partial<TimelineSource> = {}): TimelineSource => ({
  momentId: randomUUID(),
  authorUserId: randomUUID(),
  occurrenceStart: new Date("1998-06-01T00:00:00.000Z"),
  recordedAt: new Date("2026-01-01T00:00:00.000Z"),
  occurrenceEnd: new Date("1998-08-31T23:59:59.000Z"),
  occurrencePrecision: "month",
  occurrenceOffsetMinutes: 0,
  visibility: "public",
  discoverable: true,
  deletedAt: null,
  moderationState: undefined,
  locationId: undefined,
  realWorldEventIds: [],
  participantUserIds: [],
  ...over,
});

describe("what belongs on the Timeline", () => {
  it("holds a Moment at the time it happened", () => {
    const moment = source();

    const row = timelineRowFor(moment);

    assert.equal(row?.momentId, moment.momentId);
    assert.deepEqual(row?.occurredAt, moment.occurrenceStart);
    assert.equal(row?.occurrencePrecision, "month");
  });

  it("keeps a private Moment, because whose Timeline it is decides later", () => {
    // Visibility is carried, not filtered on. Somebody's own private history is
    // theirs to navigate, and dropping it here would make that impossible
    // rather than merely restricted.
    const row = timelineRowFor(source({ visibility: "private" }));

    assert.equal(row?.visibility, "private");
  });

  it("carries whether a Moment may be offered to somebody who did not ask", () => {
    assert.equal(timelineRowFor(source({ discoverable: false }))?.discoverable, false);
    assert.equal(timelineRowFor(source({ discoverable: true }))?.discoverable, true);
  });
});

describe("what the Timeline must not hold", () => {
  it("drops a deleted Moment", () => {
    assert.equal(timelineRowFor(source({ deletedAt: new Date() })), undefined);
  });

  it("drops one moderation has removed", () => {
    assert.equal(timelineRowFor(source({ moderationState: "removed" })), undefined);
  });

  it("drops one whose moderation state it cannot read", () => {
    // A worker older than the vocabulary it is reading withholds rather than
    // guesses. `search.md:295` requires eligibility that cannot be determined
    // to deny, and a Timeline is a place a mistake here would be visible.
    assert.equal(timelineRowFor(source({ moderationState: "something-newer" })), undefined);
  });

  it("keeps one moderation has merely restricted", () => {
    // Restriction is not removal: the Moment still happened, its author may
    // still navigate to it, and what an ineligible Viewer sees is decided when
    // the Timeline is read.
    const row = timelineRowFor(source({ moderationState: "restricted_from_amplification" }));

    assert.equal(row?.moderationState, "restricted_from_amplification");
  });
});

describe("reading an occurrence precision", () => {
  for (const precision of ["instant", "day", "month", "year"]) {
    it(`reads ${precision}`, () => {
      assert.equal(readPrecision(precision), precision);
    });
  }

  it("falls back to a day for anything it does not know", () => {
    // Deliberately not a drop. A Moment with an unreadable precision still
    // happened; showing it to the day is a smaller error than removing it from
    // history, and removal is the one outcome a chronology cannot recover from.
    assert.equal(readPrecision("fortnight"), "day");
    assert.equal(readPrecision(""), "day");
  });
});
