import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { MomentSignificanceRepository } from "../../features/moments/moment-significance.repository.js";
import { ALGORITHM_VERSION } from "../../features/moments/significance.scoring.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { createLocation, createRealWorldEvent, createUser } from "../../testing/fixtures.js";
import {
  recomputeSignificanceBatch,
  recomputeSignificanceFor,
} from "./recompute-significance.js";

/**
 * Deriving significance from the shape of history, against real PostgreSQL.
 *
 * The claims here are about graph structure — that a chain makes its first
 * Moment consequential, that later history changes the reading of an earlier
 * Moment, that convergence means separate people rather than repeated posting.
 * None of them can be proven against a stubbed database, because what is being
 * tested is what recursive SQL over a real graph actually returns.
 *
 * Requires `pnpm infra:up`. Run with `pnpm test:integration`.
 */

const databaseConfig = {
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? "5432"),
  database: process.env.POSTGRES_DATABASE ?? "chronologity",
  user: process.env.POSTGRES_USER ?? "chronologity",
  password: process.env.POSTGRES_PASSWORD ?? "chronologity",
};

describe("deriving significance from history", () => {
  let database: Database;
  let significance: MomentSignificanceRepository;

  beforeAll(async () => {
    database = createDatabase(databaseConfig);
    await connectDatabase(database);
    await migrate(database.dataSource);
    significance = new MomentSignificanceRepository(database.dataSource);
  });

  afterAll(() => database.close());

  /** A Moment inserted directly, at a chosen time, for a chosen author. */
  const aMoment = async (
    authorUserId: string,
    occurrence = "2020-01-01T00:00:00Z",
  ): Promise<string> => {
    const momentId = randomUUID();

    await database.dataSource.query(
      `INSERT INTO moments (
         moment_id, author_user_id, caption, occurrence_start, occurrence_end,
         occurrence_precision, occurrence_offset_minutes, created_at, updated_at
       ) VALUES ($1, $2, 'Something', $3, $3, 'instant', 0, now(), now())`,
      [momentId, authorUserId, occurrence],
    );

    return momentId;
  };

  const relate = async (source: string, target: string, kind: string, asserter: string) => {
    await database.dataSource.query(
      `INSERT INTO moment_relationships (
         relationship_id, source_moment_id, target_moment_id, kind, origin,
         asserted_by_user_id, created_at
       ) VALUES ($1, $2, $3, $4, 'asserted', $5, now())`,
      [randomUUID(), source, target, kind, asserter],
    );
  };

  /**
   * Reassess exactly the Moments a test made.
   *
   * Not a sweep. The database carries whatever every other suite left behind,
   * so reassessing everything to check one Moment is both slow and unreliable —
   * a batch may simply not reach the Moment under test.
   */
  const reassess = async (...momentIds: string[]) => {
    for (const momentId of momentIds) {
      await recomputeSignificanceFor({ dataSource: database.dataSource, significance }, momentId);
    }
  };

  const valueOf = async (
    momentId: string,
    dimension: string,
    scopeType = "global",
  ): Promise<number> => {
    const rows: { value: number }[] = await database.dataSource.query(
      `SELECT value FROM moment_significance
        WHERE moment_id = $1 AND dimension = $2 AND scope_type = $3`,
      [momentId, dimension, scopeType],
    );

    return rows[0]?.value ?? 0;
  };

  it("makes the head of a chain more consequential than its middle", async () => {
    const author = await createUser(database.dataSource);
    const [a, b, c, d] = [
      await aMoment(author.userId, "2020-01-01T00:00:00Z"),
      await aMoment(author.userId, "2020-02-01T00:00:00Z"),
      await aMoment(author.userId, "2020-03-01T00:00:00Z"),
      await aMoment(author.userId, "2020-04-01T00:00:00Z"),
    ];
    await relate(a!, b!, "led_to", author.userId);
    await relate(b!, c!, "led_to", author.userId);
    await relate(c!, d!, "led_to", author.userId);

    await reassess(a!, b!, c!, d!);

    // Every Moment in this chain has exactly one outgoing edge. If causal
    // significance were out-degree they would score identically, which
    // invariant 7 forbids: the whole chain descends from the first.
    assert.equal(await valueOf(a!, "causal"), 3);
    assert.equal(await valueOf(c!, "causal"), 1);
    assert.ok((await valueOf(a!, "causal")) > (await valueOf(c!, "causal")));
  });

  it("raises an earlier Moment when later history arrives", async () => {
    const author = await createUser(database.dataSource);
    const early = await aMoment(author.userId, "1998-01-01T00:00:00Z");
    const next = await aMoment(author.userId, "1999-01-01T00:00:00Z");
    await relate(early, next, "led_to", author.userId);
    await reassess(early, next);

    const before = await valueOf(early, "causal");

    const later = await aMoment(author.userId, "2005-01-01T00:00:00Z");
    await relate(next, later, "led_to", author.userId);
    await reassess(early, next, later);

    // "Later causal history may increase the significance of earlier Moments."
    assert.ok((await valueOf(early, "causal")) > before);
    // And retrospective significance is how far it rose since first assessed —
    // visible only because the baseline was kept.
    assert.ok((await valueOf(early, "retrospective")) > 0);
  });

  it("gives no retrospective significance to a Moment that was always consequential", async () => {
    const author = await createUser(database.dataSource);
    const head = await aMoment(author.userId, "2001-01-01T00:00:00Z");
    const tail = await aMoment(author.userId, "2002-01-01T00:00:00Z");
    await relate(head, tail, "led_to", author.userId);

    await reassess(head, tail);
    await reassess(head, tail);

    assert.ok((await valueOf(head, "causal")) > 0);
    assert.equal(await valueOf(head, "retrospective"), 0);
  });

  it("marks the earliest Moment at a place as a boundary and not the middle", async () => {
    const author = await createUser(database.dataSource);
    const locationId = await createLocation(database.dataSource, author.userId);
    const moments = [
      await aMoment(author.userId, "2010-01-01T00:00:00Z"),
      await aMoment(author.userId, "2011-01-01T00:00:00Z"),
      await aMoment(author.userId, "2012-01-01T00:00:00Z"),
    ];

    for (const momentId of moments) {
      await database.dataSource.query(
        `INSERT INTO moment_locations (moment_id, location_id, origin, created_at)
         VALUES ($1, $2, 'user-asserted', now())`,
        [momentId, locationId],
      );
    }

    await reassess(...moments);

    const first = await valueOf(moments[0]!, "temporal", "person");
    const middle = await valueOf(moments[1]!, "temporal", "person");

    // The first photograph you have of a place is a beginning. The second is a
    // Tuesday — and asserting that it scores exactly nothing is what makes the
    // rule testable. Comparing the two alone would still pass if everything at
    // a place counted, because the first is also the earliest in the record.
    assert.ok(first > middle);
    assert.equal(middle, 0);
  });

  it("counts separate people converging, never repeated posting", async () => {
    const first = await createUser(database.dataSource);
    const second = await createUser(database.dataSource);
    const shared = await createRealWorldEvent(database.dataSource, first.userId);
    const alone = await createRealWorldEvent(database.dataSource, first.userId);

    const tie = async (momentId: string, eventId: string) => {
      await database.dataSource.query(
        `INSERT INTO moment_real_world_events (moment_id, real_world_event_id, origin, created_at)
         VALUES ($1, $2, 'user-asserted', now())`,
        [momentId, eventId],
      );
    };

    const theirs = await aMoment(first.userId);
    const mine = await aMoment(second.userId);
    await tie(theirs, shared);
    await tie(mine, shared);

    const twiceOver = [await aMoment(first.userId), await aMoment(first.userId)];
    for (const momentId of twiceOver) {
      await tie(momentId, alone);
    }

    await reassess(theirs, mine, ...twiceOver);

    // Two people at one Event is convergence. One person twice is one
    // perspective, however many times it is recorded.
    assert.ok((await valueOf(theirs, "collective", "real_world_event")) > 0);
    assert.equal(await valueOf(twiceOver[0]!, "collective", "real_world_event"), 0);
  });

  it("treats another account as corroboration and a dispute as neither", async () => {
    const author = await createUser(database.dataSource);
    const witness = await createUser(database.dataSource);
    const corroborated = await aMoment(author.userId);
    const disputed = await aMoment(author.userId);

    await relate(corroborated, await aMoment(witness.userId), "alternate_perspective", author.userId);
    await relate(disputed, await aMoment(witness.userId), "contradicts", author.userId);

    await reassess(corroborated, disputed);

    // Being independently witnessed makes a Moment better attested. Being
    // argued about makes it contested, which is not evidence either way.
    assert.ok((await valueOf(corroborated, "evidentiary")) > 0);
    assert.equal(await valueOf(disputed, "evidentiary"), 0);
  });

  it("keeps a personal mark in its own scope and out of the global one", async () => {
    const author = await createUser(database.dataSource);
    const other = await createUser(database.dataSource);
    const momentId = await aMoment(author.userId);

    await database.dataSource.query(
      `INSERT INTO moment_personal_significance (moment_id, user_id, marked_at)
       VALUES ($1, $2, now())`,
      [momentId, other.userId],
    );

    await reassess(momentId);

    const rows: { scope_type: string; scope_id: string; provenance: string }[] =
      await database.dataSource.query(
        `SELECT scope_type, scope_id, provenance FROM moment_significance
          WHERE moment_id = $1 AND dimension = 'personal'`,
        [momentId],
      );

    // A mark says something about one person's relationship to a Moment and
    // nothing about universal importance, so it never reaches the global scope.
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.scope_type, "person");
    assert.equal(rows[0]?.scope_id, other.userId);
    assert.equal(rows[0]?.provenance, "human");
  });

  it("changes nothing when run twice over unchanged history", async () => {
    const author = await createUser(database.dataSource);
    const momentId = await aMoment(author.userId);
    await relate(momentId, await aMoment(author.userId), "led_to", author.userId);

    await reassess(momentId);
    const first: { dimension: string; value: number }[] = await database.dataSource.query(
      `SELECT dimension, value FROM moment_significance WHERE moment_id = $1 ORDER BY dimension`,
      [momentId],
    );

    await reassess(momentId);
    const again: { dimension: string; value: number }[] = await database.dataSource.query(
      `SELECT dimension, value FROM moment_significance WHERE moment_id = $1 ORDER BY dimension`,
      [momentId],
    );

    assert.deepEqual(again, first);
  });

  it("sweeps a batch, stalest first", async () => {
    const author = await createUser(database.dataSource);
    await aMoment(author.userId);

    const swept = await recomputeSignificanceBatch({
      dataSource: database.dataSource,
      significance,
      batchSize: 5,
    });

    // The worker's own entry point. A never-assessed Moment sorts before any
    // assessed one, so a sweep always finds new history first.
    assert.ok(swept.reassessed > 0);
  });

  it("stamps every value with what computed it and where it came from", async () => {
    const author = await createUser(database.dataSource);
    const momentId = await aMoment(author.userId);

    await reassess(momentId);

    const rows: { algorithm_version: string; provenance: string }[] =
      await database.dataSource.query(
        `SELECT algorithm_version, provenance FROM moment_significance WHERE moment_id = $1`,
        [momentId],
      );

    assert.ok(rows.length > 0);
    for (const row of rows) {
      // So algorithm evolution can be told from historical change, and an
      // explicit human attribution from an inference.
      assert.equal(row.algorithm_version, ALGORITHM_VERSION);
      assert.ok(["human", "graph", "rule"].includes(row.provenance));
    }
  });
});
