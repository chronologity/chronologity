import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { createAnalytics, type Analytics } from "../../lib/clickhouse/clickhouse.js";
import { migrateAnalytics } from "../../lib/clickhouse/migrations.js";
import { testAppConfig } from "../../testing/app-config.js";
import { createLocation, createUser } from "../../testing/fixtures.js";
import { TimelineEligibilityResolver } from "./timeline.eligibility.js";
import { TimelineReadRepository } from "./timeline.read.repository.js";
import { TimelineRepository } from "./timeline.repository.js";
import type { TimelineRow } from "./timeline-row.js";

/**
 * Who may see what, in a scope with many authors.
 *
 * This is the sub-phase's whole risk. A mistake in navigation is a bug; a
 * mistake here shows somebody history that was never theirs to see — so every
 * row of the eligibility matrix is a case, and each is driven against both real
 * stores rather than a fake that would agree with whatever I assumed.
 *
 * Requires `pnpm infra:up`.
 */

const config = testAppConfig("timeline-eligibility-integration");

describe("who may see a scope's history", () => {
  let database: Database;
  let analytics: Analytics;
  let timeline: TimelineRepository;
  let reads: TimelineReadRepository;
  let eligibility: TimelineEligibilityResolver;

  const version = `elig-${randomUUID().slice(0, 8)}`;
  let locationId: string;
  let scope: { type: "location"; id: string };

  let viewer: string;
  let author: string;
  let blockedAuthor: string;
  let suspendedAuthor: string;

  const moments: Record<string, string> = {};

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    analytics = createAnalytics(config.clickhouse);
    await migrateAnalytics(analytics.client);

    timeline = new TimelineRepository(analytics.client, version);
    reads = new TimelineReadRepository(analytics.client, version);
    eligibility = new TimelineEligibilityResolver(database.dataSource);

    viewer = (await createUser(database.dataSource)).userId;
    locationId = await createLocation(database.dataSource, viewer);
    scope = { type: "location", id: locationId };
    author = (await createUser(database.dataSource)).userId;
    blockedAuthor = (await createUser(database.dataSource)).userId;
    suspendedAuthor = (await createUser(database.dataSource)).userId;

    // One Location, several authors, one Moment of each kind the matrix names.
    const place = async (
      key: string,
      over: Partial<TimelineRow> & { authorUserId: string },
      year = 2000,
    ) => {
      const momentId = randomUUID();
      moments[key] = momentId;

      const row: TimelineRow = {
        momentId,
        occurredAt: new Date(`${year}-06-01T00:00:00.000Z`),
        occurrenceEnd: new Date(`${year}-06-01T00:00:00.000Z`),
        occurrencePrecision: "day",
        occurrenceOffsetMinutes: 0,
        visibility: "public",
        moderationState: "allowed",
        discoverable: true,
        ...over,
      };

      // The Moment exists in PostgreSQL as well as in the projection. The
      // audience row below has a foreign key to it, and a fixture that lived
      // only in ClickHouse would make the audience case untestable — which is
      // the case that decides whether restricted history leaks.
      await database.dataSource.query(
        `INSERT INTO moments (moment_id, author_user_id, caption, occurrence_start,
                              occurrence_end, occurrence_precision, occurrence_offset_minutes,
                              visibility, discoverable, created_at, updated_at)
         VALUES ($1, $2, 'fixture', $3, $3, 'day', 0, $4, true, now(), now())`,
        [momentId, row.authorUserId, row.occurredAt, row.visibility],
      );

      // Membership in PostgreSQL as well, because the audience lookup is scoped
      // by it — that is what bounds "restricted Moments naming me" to this
      // Location rather than to everything anybody ever named me in.
      await database.dataSource.query(
        `INSERT INTO moment_locations (moment_id, location_id) VALUES ($1, $2)`,
        [momentId, locationId],
      );

      await timeline.project(row);
      await timeline.projectContexts(row, [{ type: "location", id: locationId }]);
    };

    await place("public", { authorUserId: author }, 2001);
    await place("private", { authorUserId: author, visibility: "private" }, 2002);
    await place("restrictedNamed", { authorUserId: author, visibility: "restricted" }, 2003);
    await place("restrictedNotNamed", { authorUserId: author, visibility: "restricted" }, 2004);
    await place("ageRestricted", { authorUserId: author, moderationState: "age_restricted" }, 2005);
    await place("blocked", { authorUserId: blockedAuthor }, 2006);
    await place("suspended", { authorUserId: suspendedAuthor }, 2007);
    await place("ownPrivate", { authorUserId: viewer, visibility: "private" }, 2008);
    // Taken down pending a decision. Public, so nothing but the moderation
    // state withholds it — which is exactly the case that was missing.
    await place(
      "temporarilyUnavailable",
      { authorUserId: author, moderationState: "temporarily_unavailable" },
      2009,
    );
    // The same state on a Moment naming the Viewer. Its own branch, because
    // being named satisfies the visibility test on its own: a rule written
    // inside that branch would withhold the public one and show this one.
    await place(
      "unavailableNamed",
      {
        authorUserId: author,
        visibility: "restricted",
        moderationState: "temporarily_unavailable",
      },
      2010,
    );
    // And one of the Viewer's own, so the rule can be shown to stop at them.
    await place(
      "ownUnavailable",
      { authorUserId: viewer, moderationState: "temporarily_unavailable" },
      2011,
    );

    // A Block, in one direction only — the rule withholds in both.
    await database.dataSource.query(
      `INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2)`,
      [blockedAuthor, viewer],
    );

    // Named in exactly one restricted Moment.
    await database.dataSource.query(
      `INSERT INTO moment_audience (moment_id, user_id) VALUES ($1, $2), ($3, $2)`,
      // The second names the Viewer in a Moment that is *also* taken down, so
      // that withholding it proves the moderation state and not merely that
      // they were left off the list.
      [moments.restrictedNamed, viewer, moments.unavailableNamed],
    );

    await timeline.recordSuspension(suspendedAuthor, true, new Date());
  });

  afterAll(async () => {
    await database.dataSource.query("DELETE FROM moments WHERE moment_id = ANY($1::uuid[])", [
      Object.values(moments),
    ]);

    for (const table of ["timeline_moments", "timeline_moment_contexts"]) {
      await analytics.client.command({
        query: `DELETE FROM ${table} WHERE projection_version = {version: String}`,
        query_params: { version },
      });
    }
    await analytics.client.command({
      query: `DELETE FROM timeline_suspended_authors WHERE user_id = {userId: String}`,
      query_params: { userId: suspendedAuthor },
    });
    await analytics.close();
    await database.close();
  });

  /** What this Viewer may see in the scope, by fixture name. */
  const visibleTo = async (who: string): Promise<string[]> => {
    const context = await eligibility.resolve(who, scope);
    const rows = await reads.scopedSlice(scope, context, undefined, "older", 100);
    const byId = new Map(Object.entries(moments).map(([key, id]) => [id, key]));

    return rows.map((row) => byId.get(row.moment_id) ?? row.moment_id).sort();
  };

  it("shows a stranger what is public and nothing else", async () => {
    const stranger = (await createUser(database.dataSource)).userId;

    // Not `ageRestricted`: a stranger with no recorded date of birth is not an
    // adult, because ambiguous security-sensitive state denies. Nor `blocked`,
    // whose author blocked this Viewer — the Block is against `viewer` rather
    // than this account, so it is visible here and withheld in the case below.
    assert.deepEqual(await visibleTo(stranger), ["blocked", "public"]);
  });

  it("withholds a Moment taken down pending a decision", async () => {
    // `hidesFromOthers` says this state hides a Moment from everybody but its
    // author, and until this test existed the Timeline did not: the state
    // reaches ClickHouse — only `removed` is refused projection — and the
    // eligibility rule tested every other state but this one. A public Moment
    // taken down went on being shown at the place it happened.
    const stranger = (await createUser(database.dataSource)).userId;

    assert.equal((await visibleTo(viewer)).includes("temporarilyUnavailable"), false);
    assert.equal((await visibleTo(stranger)).includes("temporarilyUnavailable"), false);
  });

  it("withholds it even from somebody named in it", async () => {
    // The case a rule written inside the visibility branch would miss. Being
    // named satisfies that branch on its own, so the check has to sit outside
    // it or a restricted Moment would outlive a public one.
    assert.equal((await visibleTo(viewer)).includes("unavailableNamed"), false);
  });

  it("still shows it to its own author", async () => {
    // Somebody must be able to navigate their own past even where nobody else
    // may — which is also what makes an appeal possible.
    assert.equal((await visibleTo(viewer)).includes("ownUnavailable"), true);
  });

  it("withholds a private Moment from everybody but its author", async () => {
    assert.equal((await visibleTo(viewer)).includes("private"), false);
  });

  it("shows a restricted Moment only to somebody named in it", async () => {
    const seen = await visibleTo(viewer);

    assert.equal(seen.includes("restrictedNamed"), true, "the named Viewer cannot see it");
    assert.equal(seen.includes("restrictedNotNamed"), false, "an unnamed Viewer can see it");
  });

  it("withholds history across a Block, whichever way it was set", async () => {
    // The Block was set by the author against the Viewer. The rule is
    // symmetric: neither may read the other's history through this scope.
    assert.equal((await visibleTo(viewer)).includes("blocked"), false);
  });

  it("withholds a suspended author's history from everybody", async () => {
    const stranger = (await createUser(database.dataSource)).userId;

    assert.equal((await visibleTo(viewer)).includes("suspended"), false);
    assert.equal((await visibleTo(stranger)).includes("suspended"), false);
  });

  it("returns a suspended author's history when the suspension lifts, without touching a Moment", async () => {
    // The property the dimension table exists for. One row decides it, and no
    // Moment of theirs is rewritten — which is what makes suspending somebody
    // with a decade of history cheap and their Timeline never half-right.
    await timeline.recordSuspension(suspendedAuthor, false, new Date(Date.now() + 1_000));

    assert.equal((await visibleTo(viewer)).includes("suspended"), true);

    await timeline.recordSuspension(suspendedAuthor, true, new Date(Date.now() + 2_000));

    assert.equal((await visibleTo(viewer)).includes("suspended"), false);
  });

  it("withholds age-restricted history from somebody who is not an adult", async () => {
    // No date of birth recorded, which is what `createUser` leaves — and the
    // rule denies rather than guessing. `visibleTo(viewer)` above shows the
    // same Moment reaching a Viewer whose age is unknown, so this asserts the
    // resolver rather than the fixture.
    const context = await eligibility.resolve(viewer, scope);

    assert.equal(context.isAdult, false, "an unknown age was treated as adult");
  });

  it("shows the Viewer their own private history in a shared scope", async () => {
    assert.equal((await visibleTo(viewer)).includes("ownPrivate"), true);
  });

  it("fills a page rather than thinning it", async () => {
    // The assertion that proves filtering happens inside the query. Asking for
    // three over history that contains withheld Moments must return three: a
    // short page would say how many were skipped.
    const context = await eligibility.resolve(viewer, scope);
    const page = await reads.scopedSlice(scope, context, undefined, "older", 3);

    assert.equal(page.length, 3);
  });

  it("counts only what the Viewer may see", async () => {
    const context = await eligibility.resolve(viewer, scope);
    const buckets = await reads.scopedBuckets(scope, context, "decade");
    const everything = await reads.scopedSlice(scope, context, undefined, "older", 100);

    assert.equal(
      buckets.reduce((total, bucket) => total + bucket.count, 0),
      everything.length,
      "the counts disclose Moments the pages withhold",
    );
  });
});
