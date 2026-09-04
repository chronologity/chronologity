import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import type { BucketRow } from "../../read-models/clickhouse/timeline-read-model.js";
import type { RepresentativeRow } from "../../read-models/postgres/representative-read-model.js";
import { distributionFrom } from "./distribution-composer.js";
import type { DistributionRequest } from "./distribution-request.js";

/**
 * Putting two stores' answers together.
 *
 * The rule under test is that counts decide which spans exist and
 * representatives only decorate them. It is what makes every way the two stores
 * can disagree — projection lag, an erasure between the statements, a Moment
 * older than the projection's calendar — resolve without any of them being
 * detected.
 */

const PERSON = randomUUID();

const request = (over: Partial<DistributionRequest> = {}): DistributionRequest => ({
  view: {
    context: { type: "person", id: PERSON },
    perspective: "all",
    filters: {},
    position: {},
    limit: 50,
    direction: "older",
    zoom: "decade",
    range: { kind: "fixed", from: "1960-01-01T00:00:00.000Z", to: "1989-12-31T00:00:00.000Z" },
  } as DistributionRequest["view"],
  scale: "decade",
  from: new Date("1960-01-01T00:00:00.000Z"),
  to: new Date("1989-12-31T00:00:00.000Z"),
  ...over,
});

/** A count, as ClickHouse renders a naive DateTime64. */
const counted = (startsAt: string, count: number): BucketRow => ({
  starts_at: startsAt,
  count,
});

/** A chosen Moment, as PostgreSQL returns one. */
const chosen = (span: string, within: number, momentId = randomUUID()): RepresentativeRow => ({
  starts_at: new Date(span),
  within_span: within,
  moment_id: momentId,
  occurrence_start: new Date(span),
  occurrence_end: new Date(span),
  occurrence_precision: "day",
  occurrence_offset_minutes: 0,
  visibility: "public",
  discoverable: true,
});

describe("distributionFrom", () => {
  it("gives each span the representatives chosen for it", () => {
    const distribution = distributionFrom(
      request(),
      [counted("1960-01-01 00:00:00.000", 12), counted("1970-01-01 00:00:00.000", 4)],
      [
        chosen("1960-01-01T00:00:00.000Z", 1),
        chosen("1960-01-01T00:00:00.000Z", 2),
        chosen("1970-01-01T00:00:00.000Z", 1),
      ],
    );

    assert.equal(distribution.buckets.length, 2);
    assert.equal(distribution.buckets[0]?.representatives.length, 2);
    assert.equal(distribution.buckets[1]?.representatives.length, 1);
  });

  it("drops a representative for a span nothing counted", () => {
    // A Moment recorded seconds ago is in PostgreSQL and not yet in the
    // projection. One recorded for 1850 can never be in the projection at all.
    // Both disappear here, by one rule, without either being detected.
    const distribution = distributionFrom(
      request(),
      [counted("1960-01-01 00:00:00.000", 3)],
      [chosen("1960-01-01T00:00:00.000Z", 1), chosen("1980-01-01T00:00:00.000Z", 1)],
    );

    assert.equal(distribution.buckets.length, 1);
    assert.equal(distribution.buckets[0]?.representatives.length, 1);
  });

  it("gives a span with nothing to show an empty list rather than null", () => {
    // Ordinary, not a failure: every Moment in the span may be one this reader
    // is entitled to know about and not to read. A null would be
    // indistinguishable from a list that failed to load.
    const distribution = distributionFrom(request(), [counted("1960-01-01 00:00:00.000", 1)], []);

    assert.deepEqual(distribution.buckets[0]?.representatives, []);
  });

  it("keeps a count that exceeds what may be shown", () => {
    const distribution = distributionFrom(
      request(),
      [counted("1960-01-01 00:00:00.000", 40)],
      [chosen("1960-01-01T00:00:00.000Z", 1)],
    );

    assert.equal(distribution.buckets[0]?.count, 40);
    assert.equal(distribution.buckets[0]?.representatives.length, 1);
  });

  it("returns spans in the order the counts came back, oldest first", () => {
    const distribution = distributionFrom(
      request(),
      [
        counted("1960-01-01 00:00:00.000", 1),
        counted("1970-01-01 00:00:00.000", 1),
        counted("1980-01-01 00:00:00.000", 1),
      ],
      [],
    );

    assert.deepEqual(
      distribution.buckets.map((bucket) => bucket.startsAt.toISOString()),
      ["1960-01-01T00:00:00.000Z", "1970-01-01T00:00:00.000Z", "1980-01-01T00:00:00.000Z"],
    );
  });

  it("keeps representatives in the order they were ranked", () => {
    const best = randomUUID();
    const next = randomUUID();
    const distribution = distributionFrom(
      request(),
      [counted("1960-01-01 00:00:00.000", 9)],
      [chosen("1960-01-01T00:00:00.000Z", 1, best), chosen("1960-01-01T00:00:00.000Z", 2, next)],
    );

    assert.deepEqual(
      distribution.buckets[0]?.representatives.map((one) => one.momentId),
      [best, next],
    );
  });

  it("reads a naive projection instant as the same moment PostgreSQL returned", () => {
    // The whole join. ClickHouse renders `1969-01-01 00:00:00.000` with no zone
    // and `pg` returns a Date; matching them as text would work until a format
    // changed and then fail as quietly as it had worked.
    const distribution = distributionFrom(
      request(),
      [counted("1969-01-01 00:00:00.000", 1)],
      [chosen("1969-01-01T00:00:00.000Z", 1)],
    );

    assert.equal(distribution.buckets[0]?.representatives.length, 1);
  });

  it("says which interval it read and how coarsely", () => {
    const distribution = distributionFrom(request(), [], []);

    assert.equal(distribution.scale, "DECADE");
    assert.equal(distribution.from.toISOString(), "1960-01-01T00:00:00.000Z");
    assert.equal(distribution.to.toISOString(), "1989-12-31T00:00:00.000Z");
    assert.deepEqual(distribution.scope, { type: "PERSON", id: PERSON });
  });

  it("returns no spans for a stretch holding no history", () => {
    assert.deepEqual(distributionFrom(request(), [], []).buckets, []);
  });

  it("presents a representative in the vocabulary the schema uses", () => {
    const distribution = distributionFrom(
      request(),
      [counted("1960-01-01 00:00:00.000", 1)],
      [chosen("1960-01-01T00:00:00.000Z", 1)],
    );
    const entry = distribution.buckets[0]?.representatives[0];

    assert.equal(entry?.readable, true);
    assert.equal(entry?.occurrencePrecision, "DAY");
    assert.equal(entry?.visibility, "PUBLIC");
  });
});
