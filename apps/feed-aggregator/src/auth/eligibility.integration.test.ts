import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  TimelineEligibilityResolver,
  type TimelineScopeRef,
} from "@chronologity/timeline-derivation";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { asQueryable } from "../read-models/postgres/queryable.js";
import { testAppConfig } from "../testing/app-config.js";
import { RequestEligibility } from "./request-eligibility.js";
import type { Viewer } from "./auth-context.js";

/**
 * What a Viewer may see, resolved through this application's own connection.
 *
 * The aggregator is the first caller to run the shared resolver's statements
 * through `pg` rather than TypeORM. Everything about that should be uneventful —
 * the placeholders are the same `$1` form — but "should be" is exactly the kind
 * of claim that belongs in a test rather than in a comment.
 *
 * What is proved here is the four facts, not which Moments come back. There is
 * no Timeline query until 9C, and the API's
 * `timeline.eligibility.integration.test.ts` already proves the effect of these
 * facts against the same shared rule.
 *
 * Rows are arranged by SQL because the fixtures that would otherwise build them
 * live in `apps/api`, which this application may not import.
 */

const config = testAppConfig();

const VIEWER = randomUUID();
const BLOCKER = randomUUID();
const BLOCKED_BY_VIEWER = randomUUID();
const CLOSED = randomUUID();
const SUSPENDED = randomUUID();
const STRANGER = randomUUID();

const PLACE = randomUUID();
const NAMED_MOMENT = randomUUID();
const UNNAMED_MOMENT = randomUUID();
const ELSEWHERE_MOMENT = randomUUID();
const ELSEWHERE = randomUUID();

let directory: Directory;
let resolver: TimelineEligibilityResolver;

const asViewer = (userId: string): Viewer => ({
  kind: "authenticated",
  identityId: randomUUID(),
  sessionId: randomUUID(),
  userId,
});

const resolve = async (userId: string, scope: TimelineScopeRef) =>
  new RequestEligibility(resolver, asViewer(userId)).forScope(scope);

const person = (id: string): TimelineScopeRef => ({ type: "person", id });
const location = (id: string): TimelineScopeRef => ({ type: "location", id });

/**
 * Create an account, and its Identity, since a User cannot exist without one.
 *
 * @param userId - The account to create.
 * @param over - Anything this account needs different: a status, a closed
 *   Timeline, or a recorded birthdate.
 * @returns Nothing.
 */
async function createAccount(
  userId: string,
  over: { status?: string; timelineIsPublic?: boolean; bornYearsAgo?: number } = {},
): Promise<void> {
  const identityId = randomUUID();

  await directory.pool.query(
    "INSERT INTO identities (identity_id, created_at) VALUES ($1, now())",
    [identityId],
  );
  await directory.pool.query(
    `INSERT INTO users (user_id, identity_id, handle, display_name, status, created_at)
     VALUES ($1, $2, $3, $3, $4, now())`,
    [userId, identityId, `h-${userId.slice(0, 8)}`, over.status ?? "active"],
  );

  if (over.timelineIsPublic !== undefined) {
    await directory.pool.query(
      `INSERT INTO user_preferences (user_id, timeline_is_public, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET timeline_is_public = $2`,
      [userId, over.timelineIsPublic],
    );
  }

  if (over.bornYearsAgo !== undefined) {
    await directory.pool.query(
      `INSERT INTO user_restricted_data (user_id, date_of_birth, minimum_age_at_creation, recorded_at)
       VALUES ($1, CURRENT_DATE - make_interval(years => $2), 13, now())`,
      [userId, over.bornYearsAgo],
    );
  }
}

beforeAll(async () => {
  directory = createDirectory(config.database);

  const present = await directory.pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.user_blocks') IS NOT NULL AS exists",
  );

  if (present.rows[0]?.exists !== true) {
    throw new Error("The schema is missing. The API owns it: run `pnpm db:migrate` and try again.");
  }

  resolver = new TimelineEligibilityResolver(asQueryable(directory.pool));

  await createAccount(VIEWER, { bornYearsAgo: 30 });
  await createAccount(BLOCKER);
  await createAccount(BLOCKED_BY_VIEWER);
  await createAccount(CLOSED, { timelineIsPublic: false });
  await createAccount(SUSPENDED, { status: "suspended" });
  // No birthdate: the case where age cannot be established.
  await createAccount(STRANGER);

  // One Block in each direction, so symmetry is tested rather than assumed.
  await directory.pool.query(
    `INSERT INTO user_blocks (blocker_user_id, blocked_user_id, created_at)
     VALUES ($1, $2, now()), ($3, $4, now())`,
    [BLOCKER, VIEWER, VIEWER, BLOCKED_BY_VIEWER],
  );

  for (const [id, name] of [
    [PLACE, "a place"],
    [ELSEWHERE, "somewhere else"],
  ] as const) {
    await directory.pool.query(
      `INSERT INTO locations (location_id, recorded_by_user_id, name, precision, source, created_at)
       VALUES ($1, $2, $3, 'unknown', 'explicit-selection', now())`,
      [id, STRANGER, name],
    );
  }

  for (const [momentId, place] of [
    [NAMED_MOMENT, PLACE],
    [UNNAMED_MOMENT, PLACE],
    [ELSEWHERE_MOMENT, ELSEWHERE],
  ] as const) {
    await directory.pool.query(
      `INSERT INTO moments (moment_id, author_user_id, caption, occurrence_start,
                            occurrence_end, occurrence_precision,
                            occurrence_offset_minutes, visibility)
       VALUES ($1, $2, 'a restricted Moment', now(), now(), 'instant', 0, 'restricted')`,
      [momentId, STRANGER],
    );
    await directory.pool.query(
      "INSERT INTO moment_locations (moment_id, location_id) VALUES ($1, $2)",
      [momentId, place],
    );
  }

  // The Viewer is named in two of them; somebody else is named in the third.
  await directory.pool.query(
    "INSERT INTO moment_audience (moment_id, user_id) VALUES ($1, $2), ($3, $4), ($5, $2)",
    [NAMED_MOMENT, VIEWER, UNNAMED_MOMENT, BLOCKER, ELSEWHERE_MOMENT],
  );
});

afterAll(async () => {
  const everybody = [VIEWER, BLOCKER, BLOCKED_BY_VIEWER, CLOSED, SUSPENDED, STRANGER];

  // Innermost first. Several of these references are `RESTRICT` rather than
  // cascading — deliberately, since what becomes of somebody's history when
  // they leave is the deletion service's decision — so the order is the
  // constraint graph read backwards rather than a preference.
  await directory.pool.query("DELETE FROM moments WHERE author_user_id = ANY($1)", [everybody]);
  await directory.pool.query("DELETE FROM locations WHERE recorded_by_user_id = ANY($1)", [
    everybody,
  ]);
  await directory.pool.query(
    "DELETE FROM user_blocks WHERE blocker_user_id = ANY($1) OR blocked_user_id = ANY($1)",
    [everybody],
  );
  await directory.pool.query("DELETE FROM user_restricted_data WHERE user_id = ANY($1)", [
    everybody,
  ]);
  await directory.pool.query("DELETE FROM user_preferences WHERE user_id = ANY($1)", [everybody]);

  const identities = await directory.pool.query<{ identity_id: string }>(
    "SELECT identity_id FROM users WHERE user_id = ANY($1)",
    [everybody],
  );

  await directory.pool.query("DELETE FROM users WHERE user_id = ANY($1)", [everybody]);
  await directory.pool.query("DELETE FROM identities WHERE identity_id = ANY($1)", [
    identities.rows.map((row) => row.identity_id),
  ]);

  await directory.close();
});

describe("blocks", () => {
  it("separates two people whichever way the Block was recorded", async () => {
    // Asymmetry here would be worse than useless: the blocked person would
    // infer the Block from results that stopped appearing one way only.
    const resolved = await resolve(VIEWER, location(PLACE));

    assert.deepEqual([...resolved.blocked].sort(), [BLOCKER, BLOCKED_BY_VIEWER].sort());
  });

  it("finds none for somebody who has blocked nobody", async () => {
    const resolved = await resolve(STRANGER, location(PLACE));

    assert.deepEqual(resolved.blocked, []);
  });
});

describe("audience", () => {
  it("carries the restricted Moments naming the Viewer within the scope", async () => {
    const resolved = await resolve(VIEWER, location(PLACE));

    assert.deepEqual(resolved.audience, [NAMED_MOMENT]);
  });

  it("leaves out one naming somebody else", async () => {
    const resolved = await resolve(VIEWER, location(PLACE));

    assert.ok(!resolved.audience.includes(UNNAMED_MOMENT));
  });

  it("is bounded by the scope rather than by everything naming the Viewer", async () => {
    // The property that keeps this list from growing with how many people have
    // ever named somebody. A Moment at another place names this Viewer too, and
    // it does not appear here.
    const here = await resolve(VIEWER, location(PLACE));
    const there = await resolve(VIEWER, location(ELSEWHERE));

    assert.deepEqual(here.audience, [NAMED_MOMENT]);
    assert.deepEqual(there.audience, [ELSEWHERE_MOMENT]);
  });
});

describe("age", () => {
  it("recognises an adult", async () => {
    const resolved = await resolve(VIEWER, location(PLACE));

    assert.equal(resolved.isAdult, true);
  });

  it("denies somebody whose age cannot be established", async () => {
    // Not a guess in their favour. Ambiguous security-sensitive state denies,
    // and an account with no recorded birthdate is ambiguous.
    const resolved = await resolve(STRANGER, location(PLACE));

    assert.equal(resolved.isAdult, false);
  });
});

describe("whether a scope may be opened at all", () => {
  it("opens a place, which belongs to nobody", async () => {
    const resolved = await resolve(VIEWER, location(PLACE));

    assert.equal(resolved.scopeIsOpen, true);
  });

  it("closes the Timeline of somebody who turned it off", async () => {
    const resolved = await resolve(VIEWER, person(CLOSED));

    assert.equal(resolved.scopeIsOpen, false);
  });

  it("still opens that Timeline to the person whose it is", async () => {
    // Nobody's own history is ever closed to them, which is also what makes an
    // appeal possible for somebody suspended.
    const resolved = await resolve(CLOSED, person(CLOSED));

    assert.equal(resolved.scopeIsOpen, true);
  });

  it("closes the Timeline of a suspended account", async () => {
    const resolved = await resolve(VIEWER, person(SUSPENDED));

    assert.equal(resolved.scopeIsOpen, false);
  });

  it("still opens it to the suspended person themselves", async () => {
    const resolved = await resolve(SUSPENDED, person(SUSPENDED));

    assert.equal(resolved.scopeIsOpen, true);
  });

  it("closes the Timeline of somebody the Viewer is separated from", async () => {
    const resolved = await resolve(VIEWER, person(BLOCKER));

    assert.equal(resolved.scopeIsOpen, false);
  });

  it("closes a Timeline nobody can find", async () => {
    // An account that does not exist reads as closed. There is nothing to show
    // either way, and denying is the right direction to be wrong in.
    const resolved = await resolve(VIEWER, person(randomUUID()));

    assert.equal(resolved.scopeIsOpen, false);
  });

  it("opens the Timeline of an ordinary person who has not closed it", async () => {
    const resolved = await resolve(VIEWER, person(STRANGER));

    assert.equal(resolved.scopeIsOpen, true);
  });
});

describe("the statements this application sends", () => {
  it("reads a person's own Timeline without asking whether it is open", async () => {
    // The short-circuit that makes an own-history read three queries rather
    // than four. Asserted through the answer rather than by counting, since
    // what matters is that it is correct and that it stays cheap.
    const resolved = await resolve(VIEWER, person(VIEWER));

    assert.equal(resolved.scopeIsOpen, true);
    assert.equal(resolved.viewerUserId, VIEWER);
  });

  it("survives an identifier that is not a UUID by refusing rather than answering", async () => {
    // Every parameter here is compared against a `uuid` column, and PostgreSQL
    // raises rather than returning nothing. A scope identifier arriving from a
    // client will be schema-checked long before here, but the failure should be
    // an error rather than an empty answer that reads like an absence.
    await assert.rejects(() => resolve(VIEWER, person("not-a-uuid")));
  });
});
