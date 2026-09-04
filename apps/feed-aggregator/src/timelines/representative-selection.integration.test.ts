import assert from "node:assert/strict";
import { viewSpecificationSchema, type ViewSpecification } from "@chronologity/contracts";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { RepresentativeReadModel } from "../read-models/postgres/representative-read-model.js";
import { createMoment, createPerson, createPlace, removePeople, type Person } from "../testing/moment-fixtures.js";
import { testAppConfig } from "../testing/app-config.js";

/**
 * Choosing what stood for a span, against the tables it is chosen from.
 *
 * Two claims that cannot be proved anywhere else.
 *
 * **A private mark never moves a representative.** `moment_significance` carries
 * one row per person who marked a Moment, in that person's own scope, with the
 * dimension `personal` — a copy of a private mark in a derived table. Matching
 * significance to a person's scope without excluding it would make the order of
 * their representatives a readout of what they privately marked, shown to
 * everybody who may open their Timeline. Ordering discloses exactly as a count
 * does, and nothing about the shape of the answer would reveal that it had.
 *
 * **One Moment per person per span.** Written as two window passes in SQL rather
 * than applied to the rows afterwards, so it cannot be lost by a later change to
 * how the answer is assembled. Without it, forty photographs of one afternoon
 * become the whole decade.
 */

const config = testAppConfig();

let directory: Directory;
let representatives: RepresentativeReadModel;
let pool: Pool;

const people: Person[] = [];

/** A decade's worth of instants, one per year, all inside the 1990s. */
const inThe1990s = (year: number): string => `199${year}-06-15T12:00:00.000Z`;

/**
 * Say how significant a Moment is, in some scope.
 *
 * @param momentId - Which Moment.
 * @param scopeType - Which kind of scope the claim is about.
 * @param scopeId - Which scope.
 * @param dimension - Which dimension of significance.
 * @param value - How much.
 * @returns Nothing.
 */
async function score(
  momentId: string,
  scopeType: string,
  scopeId: string,
  dimension: string,
  value: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO moment_significance
       (moment_id, scope_type, scope_id, dimension, value, baseline_value, provenance,
        algorithm_version, computed_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6, 'test-1', now())`,
    [momentId, scopeType, scopeId, dimension, value, dimension === "personal" ? "human" : "rule"],
  );
}

/** A view over somebody's own history across the 1990s. */
const decadeOf = (context: ViewSpecification["context"]): ViewSpecification =>
  viewSpecificationSchema.parse({
    context,
    range: { kind: "fixed", from: "1990-01-01T00:00:00.000Z", to: "1999-12-31T23:59:59.000Z" },
    zoom: "decade",
  });

beforeAll(async () => {
  directory = createDirectory(config.database);
  pool = directory.pool;
  representatives = new RepresentativeReadModel(pool);
});

afterAll(async () => {
  await removePeople(pool, people);
  await directory.pool.end();
});

describe("a private mark never moves a representative", () => {
  it("orders by shared significance, whatever the reader marked privately", async () => {
    const alice = await createPerson(pool);
    people.push(alice);

    // Five Moments, ranked plainly by the one dimension a person's scope has.
    const moments: string[] = [];

    for (let index = 0; index < 5; index += 1) {
      const momentId = await createMoment(pool, alice.userId, { occurredAt: inThe1990s(index) });

      await score(momentId, "person", alice.userId, "temporal", 100 - index * 10);
      moments.push(momentId);
    }

    const before = await representatives.choose(
      decadeOf({ type: "person", id: alice.userId }),
      "decade",
      alice.userId,
      true,
    );

    // Now Alice privately marks the *least* significant of them, hard enough to
    // outrank everything if the mark counted.
    await score(moments[4] as string, "person", alice.userId, "personal", 100_000);

    const after = await representatives.choose(
      decadeOf({ type: "person", id: alice.userId }),
      "decade",
      alice.userId,
      true,
    );

    assert.deepEqual(
      after.map((row) => row.moment_id),
      before.map((row) => row.moment_id),
    );
    assert.equal(after[0]?.moment_id, moments[0]);
  });

  it("does not let one person's mark reorder what another reader is shown", async () => {
    const author = await createPerson(pool);
    const stranger = await createPerson(pool);
    people.push(author, stranger);

    const dull = await createMoment(pool, author.userId, { occurredAt: inThe1990s(1) });
    const notable = await createMoment(pool, author.userId, { occurredAt: inThe1990s(2) });

    await score(notable, "person", author.userId, "temporal", 90);
    await score(dull, "person", author.userId, "temporal", 10);
    // The author marks the dull one. Nobody else's ordering may notice.
    await score(dull, "person", author.userId, "personal", 100_000);

    const seen = await representatives.choose(
      decadeOf({ type: "person", id: author.userId }),
      "decade",
      stranger.userId,
      true,
    );

    assert.equal(seen[0]?.moment_id, notable);
  });
});

describe("one Moment per person per span", () => {
  it("takes an author's best rather than all of their afternoon", async () => {
    const place = await createPerson(pool);
    const prolific = await createPerson(pool);
    people.push(place, prolific);

    const anchor = await createMoment(pool, place.userId, { occurredAt: inThe1990s(0) });
    const locationId = await createPlace(pool, anchor, place.userId, "The Garden");

    // One person, five Moments in the same decade, one clearly the best.
    const theirs: string[] = [];

    for (let index = 0; index < 5; index += 1) {
      const momentId = await createMoment(pool, prolific.userId, { occurredAt: inThe1990s(index) });

      await pool.query("INSERT INTO moment_locations (moment_id, location_id) VALUES ($1, $2)", [
        momentId,
        locationId,
      ]);
      await score(momentId, "location", locationId, "collective", 10 + index);
      theirs.push(momentId);
    }

    const chosen = await representatives.choose(
      viewSpecificationSchema.parse({
        context: { type: "location", id: locationId },
        range: { kind: "fixed", from: "1990-01-01T00:00:00.000Z", to: "1999-12-31T23:59:59.000Z" },
        zoom: "decade",
      }),
      "decade",
      place.userId,
      true,
    );

    const fromProlific = chosen.filter((row) => theirs.includes(row.moment_id));

    assert.equal(fromProlific.length, 1);
    // Their best, which is the last one scored highest.
    assert.equal(fromProlific[0]?.moment_id, theirs[4]);
  });

  it("fills the three slots from three different people", async () => {
    const host = await createPerson(pool);
    people.push(host);

    const anchor = await createMoment(pool, host.userId, { occurredAt: inThe1990s(0) });
    const locationId = await createPlace(pool, anchor, host.userId, "The Hall");

    for (let index = 0; index < 4; index += 1) {
      const guest = await createPerson(pool);

      people.push(guest);

      const momentId = await createMoment(pool, guest.userId, { occurredAt: inThe1990s(index) });

      await pool.query("INSERT INTO moment_locations (moment_id, location_id) VALUES ($1, $2)", [
        momentId,
        locationId,
      ]);
      await score(momentId, "location", locationId, "collective", 50 + index);
    }

    const chosen = await representatives.choose(
      viewSpecificationSchema.parse({
        context: { type: "location", id: locationId },
        range: { kind: "fixed", from: "1990-01-01T00:00:00.000Z", to: "1999-12-31T23:59:59.000Z" },
        zoom: "decade",
      }),
      "decade",
      host.userId,
      true,
    );
    const authors = new Set(chosen.map((row) => row.moment_id));

    // Four people offered, three slots, and no two from the same person.
    assert.equal(chosen.length, 3);
    assert.equal(authors.size, 3);
  });
});

describe("a Moment nobody scored", () => {
  it("is still selectable, and orders after everything that was scored", async () => {
    // Two authors, because one person contributes one Moment to a span however
    // many they recorded — which is the rule proved above, and would otherwise
    // hide what this test is about.
    const host = await createPerson(pool);
    const guest = await createPerson(pool);
    people.push(host, guest);

    const anchor = await createMoment(pool, host.userId, { occurredAt: inThe1990s(0) });
    const locationId = await createPlace(pool, anchor, host.userId, "The Long Room");
    const scored = await createMoment(pool, guest.userId, { occurredAt: inThe1990s(1) });

    // The anchor is already at the place: creating one puts it there.
    await pool.query("INSERT INTO moment_locations (moment_id, location_id) VALUES ($1, $2)", [
      scored,
      locationId,
    ]);
    await score(scored, "location", locationId, "collective", 5);

    const chosen = await representatives.choose(
      viewSpecificationSchema.parse({
        context: { type: "location", id: locationId },
        range: { kind: "fixed", from: "1990-01-01T00:00:00.000Z", to: "1999-12-31T23:59:59.000Z" },
        zoom: "decade",
      }),
      "decade",
      host.userId,
      true,
    );

    // The unscored one is present rather than dropped, and sorts behind the
    // scored one: scoring nothing is nothing, not exclusion.
    assert.deepEqual(
      chosen.map((row) => row.moment_id),
      [scored, anchor],
    );
  });

  it("orders the same way every time it is asked", async () => {
    const host = await createPerson(pool);
    people.push(host);

    const anchor = await createMoment(pool, host.userId, { occurredAt: inThe1990s(0) });
    const locationId = await createPlace(pool, anchor, host.userId, "The Reading Room");

    // Four people, none of them scored, so only the tiebreak decides the order.
    for (let index = 0; index < 4; index += 1) {
      const guest = await createPerson(pool);

      people.push(guest);

      const momentId = await createMoment(pool, guest.userId, { occurredAt: inThe1990s(index + 1) });

      await pool.query("INSERT INTO moment_locations (moment_id, location_id) VALUES ($1, $2)", [
        momentId,
        locationId,
      ]);
    }

    const view = viewSpecificationSchema.parse({
      context: { type: "location", id: locationId },
      range: { kind: "fixed", from: "1990-01-01T00:00:00.000Z", to: "1999-12-31T23:59:59.000Z" },
      zoom: "decade",
    });
    const runs = await Promise.all([
      representatives.choose(view, "decade", host.userId, true),
      representatives.choose(view, "decade", host.userId, true),
      representatives.choose(view, "decade", host.userId, true),
    ]);

    assert.equal(runs[0]?.length, 3);
    assert.deepEqual(runs[1]?.map((row) => row.moment_id), runs[0]?.map((row) => row.moment_id));
    assert.deepEqual(runs[2]?.map((row) => row.moment_id), runs[0]?.map((row) => row.moment_id));
  });
});

describe("a representative is one the reader may read", () => {
  it("never offers a private Moment to somebody else", async () => {
    const author = await createPerson(pool);
    const stranger = await createPerson(pool);
    people.push(author, stranger);

    const hidden = await createMoment(pool, author.userId, {
      occurredAt: inThe1990s(1),
      visibility: "private",
    });

    await score(hidden, "person", author.userId, "temporal", 100_000);

    const seen = await representatives.choose(
      decadeOf({ type: "person", id: author.userId }),
      "decade",
      stranger.userId,
      true,
    );

    assert.ok(!seen.some((row) => row.moment_id === hidden));
  });

  it("offers a private Moment to its own author", async () => {
    const author = await createPerson(pool);
    people.push(author);

    const own = await createMoment(pool, author.userId, {
      occurredAt: inThe1990s(1),
      visibility: "private",
    });

    const seen = await representatives.choose(
      decadeOf({ type: "person", id: author.userId }),
      "decade",
      author.userId,
      true,
    );

    assert.deepEqual(seen.map((row) => row.moment_id), [own]);
  });

  it("never offers a Moment whose author blocked the reader", async () => {
    const author = await createPerson(pool);
    const blocked = await createPerson(pool);
    people.push(author, blocked);

    const momentId = await createMoment(pool, author.userId, { occurredAt: inThe1990s(1) });

    await pool.query(
      "INSERT INTO user_blocks (blocker_user_id, blocked_user_id, created_at) VALUES ($1, $2, now())",
      [author.userId, blocked.userId],
    );

    const seen = await representatives.choose(
      decadeOf({ type: "person", id: author.userId }),
      "decade",
      blocked.userId,
      true,
    );

    assert.ok(!seen.some((row) => row.moment_id === momentId));
  });

  it("never offers a deleted Moment to anybody, its author included", async () => {
    const author = await createPerson(pool);
    people.push(author);

    const erased = await createMoment(pool, author.userId, { occurredAt: inThe1990s(1) });

    await pool.query("UPDATE moments SET deleted_at = now() WHERE moment_id = $1", [erased]);

    const seen = await representatives.choose(
      decadeOf({ type: "person", id: author.userId }),
      "decade",
      author.userId,
      true,
    );

    assert.ok(!seen.some((row) => row.moment_id === erased));
  });
});
