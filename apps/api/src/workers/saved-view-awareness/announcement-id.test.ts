import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { announcementIdFor } from "./recount-awareness.js";

/**
 * The identifier a view's growth is announced under.
 *
 * The sweep runs every minute or so and recounts the same views forever, so
 * something has to stop it announcing the same growth every pass. That
 * something is this: the notification ledger is keyed on the event identifier
 * and the recipient, so an identifier that stays the same across an unvisited
 * window is recorded once and thereafter recognised as a duplicate.
 *
 * Which makes two properties load-bearing — stable while nothing has changed,
 * and different once somebody has looked — and neither is visible by reading the
 * sweep, because both only show up on the second pass.
 */

const VIEW = randomUUID();
const OTHER = randomUUID();
const VISIT = new Date("2026-08-30T09:00:00.000Z");

describe("announcing that a view has grown", () => {
  it("says the same thing every time until somebody looks", () => {
    // The property the whole arrangement rests on. A random identifier here
    // would announce on every sweep, which for a minute-by-minute sweep is a
    // notification a minute.
    assert.equal(announcementIdFor(VIEW, VISIT), announcementIdFor(VIEW, VISIT));
  });

  it("says something new once somebody has looked", () => {
    // Visiting opens a new window, so the next arrival is announced again
    // rather than being folded into an entry the reader has already dealt with.
    const later = new Date(VISIT.getTime() + 1000);

    assert.notEqual(announcementIdFor(VIEW, VISIT), announcementIdFor(VIEW, later));
  });

  it("tells one view's growth from another's", () => {
    assert.notEqual(announcementIdFor(VIEW, VISIT), announcementIdFor(OTHER, VISIT));
  });

  it("has something to say about a view nobody has ever opened", () => {
    // Null is a window too — the one running from when the view was saved.
    const never = announcementIdFor(VIEW, null);

    assert.equal(never, announcementIdFor(VIEW, null));
    assert.notEqual(never, announcementIdFor(VIEW, VISIT));
  });

  it("is shaped like an identifier the database will accept", () => {
    // Stored in a uuid column. A digest that merely looked unique would be
    // refused on write, in a worker, long after this decision was made.
    assert.match(
      announcementIdFor(VIEW, VISIT),
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
