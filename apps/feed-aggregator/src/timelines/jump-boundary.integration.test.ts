import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  asClickHouseDateTime,
  toRecord,
  TimelineEligibilityResolver,
  type TimelineRow,
} from "@chronologity/timeline-derivation";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, it } from "vitest";
import { SessionRepository } from "../auth/session.repository.js";
import type { AppConfig } from "../config/app-config.js";
import { createReadStore, type ReadStore } from "../read-models/clickhouse/client.js";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { asQueryable } from "../read-models/postgres/queryable.js";
import { buildApp } from "../server/app.js";
import { testAppConfig } from "../testing/app-config.js";
import { createMoment, createPerson, removePeople, type Person } from "../testing/moment-fixtures.js";

/**
 * Landing at a position, against the store that answers.
 *
 * **The partition invariant is what this exists for.** A landing is two pages,
 * and their correctness is a single property: together they cover the readable
 * axis exactly once. If the boundary were strict on both sides, a Moment at the
 * anchor would vanish from a Timeline that plainly contains it; if inclusive on
 * both, it would appear twice. Neither shows up as an error — the answer just
 * quietly has a hole or a double.
 *
 * Moments sharing one instant are the case that finds it, because an instant
 * cannot split them: it names none of them.
 */

const VERSION = `test-${randomUUID().slice(0, 8)}`;
const base = testAppConfig();
const config: AppConfig = {
  ...base,
  clickhouse: { ...base.clickhouse, projectionVersion: VERSION },
};

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;
let owner: Person & { token: string };

const people: Person[] = [];
/** Moment identifiers by the label this suite knows them under. */
const ID: Record<string, string> = {};

const AROUND = `query Around($view: TimelineViewInput!, $anchor: TimelineAnchorInput!, $first: Int) {
  timelineAround(view: $view, anchor: $anchor, first: $first) {
    anchoredAt
    scope { type id }
    reason
    at { __typename ... on ReadableTimelineEntry { momentId occurredAt } }
    older { edges { cursor node { ... on ReadableTimelineEntry { momentId occurredAt } } }
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage } }
    newer { edges { cursor node { ... on ReadableTimelineEntry { momentId occurredAt } } }
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage } }
  }
}`;

const PAGE = `query Page($view: TimelineViewInput!, $first: Int, $after: Cursor) {
  timeline(view: $view, first: $first, after: $after) {
    edges { node { ... on ReadableTimelineEntry { momentId } } }
  }
}`;

/**
 * Put a Moment into the projection, on the owner's Timeline.
 *
 * @param label - What this suite calls it.
 * @param occurredAt - When it happened.
 * @returns Nothing.
 */
async function record(label: string, occurredAt: string): Promise<void> {
  const momentId = await createMoment(directory.pool, owner.userId, { occurredAt });

  ID[label] = momentId;

  const row: TimelineRow = {
    momentId,
    authorUserId: owner.userId,
    occurredAt: new Date(occurredAt),
    recordedAt: new Date(),
    occurrenceEnd: new Date(occurredAt),
    occurrencePrecision: "instant",
    occurrenceOffsetMinutes: 0,
    visibility: "public",
    moderationState: "allowed",
    discoverable: true,
  };
  const projectedAt = new Date();

  await store.client.insert({
    table: "timeline_moments",
    values: [toRecord(row, projectedAt, VERSION)],
    format: "JSONEachRow",
  });
  await store.client.insert({
    table: "timeline_moment_contexts",
    values: [
      {
        context_type: "person",
        context_id: owner.userId,
        occurred_at: asClickHouseDateTime(row.occurredAt),
        moment_id: momentId,
        author_user_id: owner.userId,
        visibility: row.visibility,
        moderation_state: row.moderationState,
        projected_at: asClickHouseDateTime(projectedAt),
        projection_version: VERSION,
      },
    ],
    format: "JSONEachRow",
  });
}

/**
 * Jump, and return the landing.
 *
 * @param anchor - How the destination is named.
 * @param first - How much history either side.
 * @returns The landing, with errors asserted absent.
 */
async function jump(anchor: Record<string, unknown>, first = 50): Promise<Landing> {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${owner.token}` },
    payload: {
      query: AROUND,
      variables: { view: { scope: { type: "PERSON", id: owner.userId } }, anchor, first },
    },
  });
  const body = response.json() as {
    data: { timelineAround: Landing } | null;
    errors?: { message: string }[];
  };

  assert.equal(body.errors, undefined, JSON.stringify(body.errors));

  return (body.data as { timelineAround: Landing }).timelineAround;
}

interface Side {
  edges: { cursor: string; node: { momentId?: string; occurredAt?: string } }[];
  pageInfo: {
    startCursor: string | null;
    endCursor: string | null;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

interface Landing {
  anchoredAt: string | null;
  scope: { type: string; id: string };
  reason: string;
  at: { momentId?: string } | null;
  older: Side;
  newer: Side;
}

/** The Moment identifiers a side returned, in order. */
const idsOf = (side: Side): string[] =>
  side.edges.map((edge) => edge.node.momentId ?? "").filter((id) => id !== "");

beforeAll(async () => {
  store = createReadStore(config.clickhouse);
  directory = createDirectory(config.database);

  const present = await directory.pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.moments') IS NOT NULL AS exists",
  );

  if (present.rows[0]?.exists !== true) {
    throw new Error("The schema is missing. The API owns it: run `pnpm db:migrate` and try again.");
  }

  app = await buildApp({
    config,
    dependencies: [store, directory],
    graphql: {
      store,
      sessions: new SessionRepository(directory.pool),
      eligibility: new TimelineEligibilityResolver(asQueryable(directory.pool)),
      directory: directory.pool,
    },
  });

  const created = await createPerson(directory.pool);
  const sessionId = randomUUID();

  people.push(created);
  await directory.pool.query(
    `INSERT INTO sessions (session_id, identity_id, created_at, expires_at, revoked_at)
     VALUES ($1, $2, now(), now() + interval '1 hour', NULL)`,
    [sessionId, created.identityId],
  );

  owner = {
    ...created,
    token: await new SignJWT({ sid: sessionId, uid: created.userId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(created.identityId)
      .setIssuer(config.auth.issuer)
      .setAudience(config.auth.audience)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(config.auth.jwtSecret),
  };

  // Three sharing one instant, with history either side of them. The tie is the
  // case an instant cannot split.
  await record("earliest", "1998-01-10T09:00:00.000Z");
  await record("tieA", "1998-07-04T19:30:00.000Z");
  await record("tieB", "1998-07-04T19:30:00.000Z");
  await record("tieC", "1998-07-04T19:30:00.000Z");
  await record("latest", "1999-12-31T23:00:00.000Z");
});

afterAll(async () => {
  for (const table of ["timeline_moment_contexts", "timeline_moments"]) {
    await store.client.command({
      query: `ALTER TABLE ${table} DELETE WHERE projection_version = '${VERSION}'`,
      clickhouse_settings: { mutations_sync: "2" },
    });
  }

  await removePeople(directory.pool, people);
  await app.close();
  await store.close();
  await directory.close();
});

describe("the two pages of a landing", () => {
  it("cover the whole Timeline exactly once", async () => {
    const landing = await jump({ instant: "1998-07-04T19:30:00.000Z" });
    const older = idsOf(landing.older);
    const newer = idsOf(landing.newer);
    const together = [...older, ...newer];

    assert.equal(new Set(together).size, together.length, "a Moment appeared in both halves");
    assert.deepEqual(
      [...together].sort(),
      [ID.earliest, ID.tieA, ID.tieB, ID.tieC, ID.latest].sort(),
      "the two halves are not the whole Timeline",
    );
  });

  it("put every Moment sharing the instant on the older side", async () => {
    // An instant names none of the Moments that share it, so it cannot split
    // them. All three belong to one side, and older is that side because its
    // first row is where the jump landed.
    const landing = await jump({ instant: "1998-07-04T19:30:00.000Z" });

    for (const label of ["tieA", "tieB", "tieC"]) {
      assert.ok(idsOf(landing.older).includes(ID[label] as string), `${label} is not in older`);
      assert.ok(!idsOf(landing.newer).includes(ID[label] as string), `${label} is also in newer`);
    }
  });

  it("split a tie by identity when a Moment is named rather than an instant", async () => {
    // A Moment anchor *can* split the tie, because it names one of them. The
    // one named is the landing; the others fall either side of it in the sort
    // key's own order.
    const landing = await jump({ moment: ID.tieB });
    const older = idsOf(landing.older);
    const newer = idsOf(landing.newer);
    const together = [...older, ...newer];

    assert.equal(landing.at?.momentId, ID.tieB);
    assert.equal(new Set(together).size, together.length);
    assert.equal(together.length, 5);
  });
});

describe("where a landing says it is", () => {
  it("lands on a Moment when one is exactly there", async () => {
    const landing = await jump({ instant: "1998-07-04T19:30:00.000Z" });

    assert.ok(["tieA", "tieB", "tieC"].some((label) => landing.at?.momentId === ID[label]));
    assert.equal(landing.anchoredAt, "1998-07-04T19:30:00.000Z");
  });

  it("keeps the position when nothing happened at it", async () => {
    // The case the product document names: a jump to a June with Moments either
    // side of it lands in June, not on whichever was nearest.
    const landing = await jump({ instant: "1998-09-01T00:00:00.000Z" });

    assert.equal(landing.at, null);
    assert.equal(landing.anchoredAt, "1998-09-01T00:00:00.000Z");
    // Everything before September is behind the position, and only the 1999
    // Moment is ahead of it.
    assert.deepEqual(
      [...idsOf(landing.older)].sort(),
      [ID.earliest, ID.tieA, ID.tieB, ID.tieC].sort(),
    );
    assert.deepEqual(idsOf(landing.newer), [ID.latest]);
  });

  it("answers from before all history with everything on the newer side", async () => {
    const landing = await jump({ instant: "1900-01-01T00:00:00.000Z" });

    assert.equal(landing.at, null);
    assert.deepEqual(idsOf(landing.older), []);
    assert.equal(idsOf(landing.newer).length, 5);
    assert.equal(landing.older.pageInfo.hasPreviousPage, true);
  });

  it("answers from after all history with everything on the older side", async () => {
    const landing = await jump({ instant: "2026-01-01T00:00:00.000Z" });

    assert.equal(landing.at, null);
    assert.equal(idsOf(landing.older).length, 5);
    assert.deepEqual(idsOf(landing.newer), []);
    assert.equal(landing.newer.pageInfo.hasNextPage, true);
  });

  it("lands on the oldest Moment there is, with nothing before it", async () => {
    const landing = await jump({ moment: ID.earliest });

    assert.equal(landing.at?.momentId, ID.earliest);
    assert.deepEqual(idsOf(landing.older), [ID.earliest]);
  });

  it("lands on the newest Moment there is, with nothing after it", async () => {
    const landing = await jump({ moment: ID.latest });

    assert.equal(landing.at?.momentId, ID.latest);
    assert.deepEqual(idsOf(landing.newer), []);
  });
});

describe("carrying on from where you land", () => {
  it("continues with a cursor from the landing, repeating nothing", async () => {
    // What `feed.md:790` asks of a jump: enough to continue ordinary navigation.
    // A cursor resumes *past* the row it names, so the page after the landing
    // must not begin with the landing again.
    const landing = await jump({ instant: "1998-07-04T19:30:00.000Z" }, 2);
    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      headers: { authorization: `Bearer ${owner.token}` },
      payload: {
        query: PAGE,
        variables: {
          view: { scope: { type: "PERSON", id: owner.userId } },
          first: 10,
          after: landing.older.pageInfo.endCursor,
        },
      },
    });
    const body = response.json() as {
      data: { timeline: { edges: { node: { momentId?: string } }[] } } | null;
      errors?: unknown[];
    };

    assert.equal(body.errors, undefined);

    const continued = (body.data as { timeline: { edges: { node: { momentId?: string } }[] } })
      .timeline.edges.map((edge) => edge.node.momentId);
    const landed = idsOf(landing.older);

    for (const id of continued) {
      assert.ok(!landed.includes(id as string), `${String(id)} was returned twice`);
    }
  });

  it("says the position it landed at, which is what takes you back", async () => {
    const landing = await jump({ moment: ID.tieA });
    const back = await jump({ instant: landing.anchoredAt as string });

    assert.equal(back.anchoredAt, landing.anchoredAt);
    assert.equal(back.reason, "INSTANT");
  });
});

describe("how a jump was made", () => {
  it("reports naming an instant as such", async () => {
    assert.equal((await jump({ instant: "1998-07-04T19:30:00.000Z" })).reason, "INSTANT");
  });

  it("reports naming a Moment as such", async () => {
    assert.equal((await jump({ moment: ID.tieA })).reason, "MOMENT");
  });

  it("says which Timeline it landed in, and the pages agree", async () => {
    const landing = await jump({ moment: ID.tieA });

    assert.deepEqual(landing.scope, { type: "PERSON", id: owner.userId });
  });
});
