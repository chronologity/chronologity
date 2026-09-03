import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ViewSpecification } from "@chronologity/contracts";
import type { TimelineReading } from "@chronologity/timeline-derivation";
import { describe, it } from "vitest";
import type { TimelineSlice } from "../read-models/clickhouse/timeline-read-model.js";
import { connectionFor, entryFor } from "./timeline-composer.js";

/**
 * Rows as a page.
 *
 * Two things are worth proving here and neither is obvious from the code. A
 * backward page arrives in the order the keyset walked it and has to come out
 * newest first like every other page, or navigation is asymmetric. And both
 * sides of `pageInfo` are answered from one query, which means the probe row
 * and the supplied cursor swap roles with the direction.
 */

const PERSON = randomUUID();

const reading = (occurredAt: string, over: Partial<TimelineReading> = {}): TimelineReading => ({
  readable: 1,
  occurred_at: occurredAt,
  recorded_at: "2026-01-01 00:00:00.000",
  moment_id: randomUUID(),
  author_user_id: PERSON,
  projected_at: "2026-01-01 00:00:00.000",
  occurrence_end: occurredAt,
  occurrence_precision: "instant",
  occurrence_offset_minutes: 60,
  visibility: "public",
  moderation_state: "none",
  discoverable: 1,
  projection_version: "timeline-v1",
  ...over,
});

const viewing = (over: Partial<ViewSpecification> = {}): ViewSpecification => ({
  derivationVersion: 1,
  context: { type: "person", id: PERSON },
  perspective: "all",
  filters: {},
  position: {},
  limit: 50,
  direction: "older",
  ...over,
});

const slice = (rows: TimelineReading[], more = false): TimelineSlice => ({ rows, more });

describe("the order a page comes back in", () => {
  it("keeps a page walked into the past as it was walked", () => {
    const newer = reading("2014-05-02 00:00:00.000");
    const older = reading("2014-05-01 00:00:00.000");

    const connection = connectionFor(slice([newer, older]), viewing(), false);

    assert.deepEqual(
      connection.edges.map((edge) => edge.node.momentId),
      [newer.moment_id, older.moment_id],
    );
  });

  it("reverses a page walked towards the present, so both read newest first", () => {
    // Asymmetric navigation is the defect `timeline.md:824` names. A page that
    // read backwards depending on how it was reached would be exactly that.
    const older = reading("2014-05-01 00:00:00.000");
    const newer = reading("2014-05-02 00:00:00.000");

    const connection = connectionFor(
      slice([older, newer]),
      viewing({ direction: "newer" }),
      false,
    );

    assert.deepEqual(
      connection.edges.map((edge) => edge.node.momentId),
      [newer.moment_id, older.moment_id],
    );
  });
});

describe("where the page sits", () => {
  it("takes a cursor from each end, so either direction is one request away", () => {
    const newer = reading("2014-05-02 00:00:00.000");
    const older = reading("2014-05-01 00:00:00.000");

    const { pageInfo } = connectionFor(slice([newer, older]), viewing(), false);

    assert.deepEqual(pageInfo.startCursor, {
      occurredAt: new Date("2014-05-02T00:00:00.000Z"),
      momentId: newer.moment_id,
    });
    assert.deepEqual(pageInfo.endCursor, {
      occurredAt: new Date("2014-05-01T00:00:00.000Z"),
      momentId: older.moment_id,
    });
  });

  it("gives an empty page no ends", () => {
    const { pageInfo, edges } = connectionFor(slice([]), viewing(), false);

    assert.deepEqual(edges, []);
    assert.equal(pageInfo.startCursor, null);
    assert.equal(pageInfo.endCursor, null);
  });

  it("puts a cursor on every edge, so any row can be resumed from", () => {
    const row = reading("2014-05-01 00:00:00.000");

    const { edges } = connectionFor(slice([row]), viewing(), false);

    assert.deepEqual(edges[0]?.cursor, {
      occurredAt: new Date("2014-05-01T00:00:00.000Z"),
      momentId: row.moment_id,
    });
  });

  it("says whose history it is, in the schema's vocabulary", () => {
    const occasion = randomUUID();

    const { scope } = connectionFor(
      slice([]),
      viewing({ context: { type: "real_world_event", id: occasion } }),
      false,
    );

    assert.deepEqual(scope, { type: "REAL_WORLD_EVENT", id: occasion });
  });
});

describe("whether there is more either side", () => {
  it("reports the probe row as more history further back when walking into the past", () => {
    const { pageInfo } = connectionFor(slice([reading("2014-05-01 00:00:00.000")], true), viewing(), false);

    assert.equal(pageInfo.hasNextPage, true);
    assert.equal(pageInfo.hasPreviousPage, false);
  });

  it("reports a supplied cursor as history between here and the present", () => {
    // Exact rather than optimistic: every cursor this service issues was taken
    // from a row it returned, so a row exists on the near side by construction.
    const { pageInfo } = connectionFor(slice([reading("2014-05-01 00:00:00.000")]), viewing(), true);

    assert.equal(pageInfo.hasNextPage, false);
    assert.equal(pageInfo.hasPreviousPage, true);
  });

  it("swaps the two when walking towards the present", () => {
    const { pageInfo } = connectionFor(
      slice([reading("2014-05-01 00:00:00.000")], true),
      viewing({ direction: "newer" }),
      true,
    );

    assert.equal(pageInfo.hasNextPage, true);
    assert.equal(pageInfo.hasPreviousPage, true);
  });

  it("says history ran out both ways for a page reached without a cursor", () => {
    const { pageInfo } = connectionFor(slice([reading("2014-05-01 00:00:00.000")]), viewing(), false);

    assert.equal(pageInfo.hasNextPage, false);
    assert.equal(pageInfo.hasPreviousPage, false);
  });
});

describe("what a row becomes", () => {
  it("presents a readable Moment with everything the Timeline shows", () => {
    const row = reading("1998-07-04 19:30:00.000", {
      occurrence_end: "1998-07-31 23:59:59.999",
      occurrence_precision: "month",
      visibility: "restricted",
      discoverable: 0,
    });

    assert.deepEqual(entryFor(row), {
      readable: true,
      momentId: row.moment_id,
      occurredAt: new Date("1998-07-04T19:30:00.000Z"),
      occurrenceEnd: new Date("1998-07-31T23:59:59.999Z"),
      occurrencePrecision: "MONTH",
      occurrenceOffsetMinutes: 60,
      visibility: "RESTRICTED",
      discoverable: false,
    });
  });

  it("reduces a withheld Moment to when it happened", () => {
    // Its author's words stay shut, and so does the offset: that is a statement
    // about where somebody was rather than when, and this person was told the
    // time and nothing else when they were asked.
    const row = reading("1998-07-04 19:30:00.000", { readable: 0, visibility: "private" });

    assert.deepEqual(entryFor(row), {
      readable: false,
      momentId: row.moment_id,
      occurredAt: new Date("1998-07-04T19:30:00.000Z"),
      occurrenceEnd: new Date("1998-07-04T19:30:00.000Z"),
      occurrencePrecision: "INSTANT",
    });
  });

  it("carries a withheld Moment into a page without leaking anything alongside it", () => {
    const withheld = reading("2014-05-01 00:00:00.000", { readable: 0 });

    const { edges } = connectionFor(slice([withheld]), viewing(), false);
    const node = edges[0]?.node;

    assert.equal(node?.readable, false);
    assert.ok(!("occurrenceOffsetMinutes" in (node ?? {})));
    assert.ok(!("visibility" in (node ?? {})));
    assert.ok(!("discoverable" in (node ?? {})));
  });
});
