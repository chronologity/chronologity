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
import type { Pool } from "pg";
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
 * Reading history span by span, through the contract a client actually uses.
 *
 * What this settles that the narrower suites cannot: whether the two stores'
 * answers are joined correctly once real rows are on both sides, whether the
 * count and the representatives obey different rules on somebody's own Timeline,
 * and whether a distribution costs the same however many spans it covers.
 *
 * **The assertion a person would notice** is that every representative falls
 * inside the span carrying it. A count off by one changes a dot's size by a
 * pixel; a Moment under the wrong week is visibly in the wrong place. Both are
 * checked, and only one of them would be reported by a user.
 *
 * It projects under a version of its own and removes it afterwards: the table is
 * shared, and a version left behind is history that never happened.
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
let statements = 0;

const people: Person[] = [];

let owner: Person & { token: string };
let friend: Person;
let stranger: Person & { token: string };

/** Moments on the owner's Timeline, by when they happened. */
const OWN: Record<string, string> = {};
/** The friend's Moment the owner is part of and may not read. */
let WITHHELD = "";

const DISTRIBUTION = `query Distribution($view: TimelineViewInput!, $scale: TimelineScale!) {
  temporalDistribution(view: $view, scale: $scale) {
    scale
    from
    to
    scope { type id }
    buckets {
      startsAt
      count
      representatives { momentId occurredAt visibility }
    }
  }
}`;

const COUNTS_ONLY = `query Counts($view: TimelineViewInput!, $scale: TimelineScale!) {
  temporalDistribution(view: $view, scale: $scale) {
    buckets { startsAt count }
  }
}`;

/**
 * A pool that counts what it is asked.
 *
 * @param pool - The real connection.
 * @returns The same pool, counting.
 */
function counting(pool: Pool): Pool {
  return new Proxy(pool, {
    get(target, property, receiver): unknown {
      if (property !== "query") {
        return Reflect.get(target, property, receiver);
      }

      return (...args: unknown[]): unknown => {
        statements += 1;

        return (target.query as (...passed: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

/**
 * Somebody new, with a Session they can read through.
 *
 * @returns The person and their credential.
 */
async function signedInPerson(): Promise<Person & { token: string }> {
  const created = await createPerson(directory.pool);
  const sessionId = randomUUID();

  people.push(created);

  await directory.pool.query(
    `INSERT INTO sessions (session_id, identity_id, created_at, expires_at, revoked_at)
     VALUES ($1, $2, now(), now() + interval '1 hour', NULL)`,
    [sessionId, created.identityId],
  );

  const token = await new SignJWT({ sid: sessionId, uid: created.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(created.identityId)
    .setIssuer(config.auth.issuer)
    .setAudience(config.auth.audience)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(config.auth.jwtSecret);

  return { ...created, token };
}

/**
 * Put a Moment into the projection, in the scopes it belongs to.
 *
 * @param moment - What happened, whose it is, how visible.
 * @param scopes - The contexts carrying it.
 * @returns Nothing.
 */
async function project(
  moment: { momentId: string; authorUserId: string; occurredAt: string; visibility: string },
  scopes: { type: string; id: string }[],
): Promise<void> {
  const row: TimelineRow = {
    momentId: moment.momentId,
    authorUserId: moment.authorUserId,
    occurredAt: new Date(moment.occurredAt),
    recordedAt: new Date(),
    occurrenceEnd: new Date(moment.occurredAt),
    occurrencePrecision: "instant",
    occurrenceOffsetMinutes: 60,
    visibility: moment.visibility as TimelineRow["visibility"],
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
    values: scopes.map((scope) => ({
      context_type: scope.type,
      context_id: scope.id,
      occurred_at: asClickHouseDateTime(row.occurredAt),
      moment_id: row.momentId,
      author_user_id: row.authorUserId,
      visibility: row.visibility,
      moderation_state: row.moderationState,
      projected_at: asClickHouseDateTime(projectedAt),
      projection_version: VERSION,
    })),
    format: "JSONEachRow",
  });
}

/**
 * Ask for a distribution.
 *
 * @param query - The document.
 * @param variables - The view and the scale.
 * @param token - The credential.
 * @returns What it cost in statements, and the body.
 */
async function ask(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<{
  cost: number;
  body: { data: Record<string, never> | null; errors?: { message: string }[] };
}> {
  statements = 0;

  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: { authorization: `Bearer ${token}` },
    payload: { query, variables },
  });

  return { cost: statements, body: response.json() };
}

/** A view over one person's history across a fixed stretch. */
const spanning = (userId: string, from: string, to: string) => ({
  scope: { type: "PERSON", id: userId },
  range: { fixed: { from, to } },
});

/** The buckets of a successful answer. */
const bucketsOf = (body: {
  data: Record<string, never> | null;
  errors?: { message: string }[];
}): { startsAt: string; count: number; representatives: { momentId: string }[] }[] => {
  assert.equal(body.errors, undefined, JSON.stringify(body.errors));

  return (body.data as never as { temporalDistribution: { buckets: never[] } }).temporalDistribution
    .buckets;
};

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
      sessions: new SessionRepository(counting(directory.pool)),
      eligibility: new TimelineEligibilityResolver(asQueryable(counting(directory.pool))),
      directory: counting(directory.pool),
    },
  });

  owner = await signedInPerson();
  stranger = await signedInPerson();
  friend = await createPerson(directory.pool);
  people.push(friend);

  // Spread deliberately: two in one month, one in another, one in a different
  // year, one before the epoch.
  const occurrences = {
    firstWeek: "1998-07-04T19:30:00.000Z",
    sameMonth: "1998-07-28T11:00:00.000Z",
    nextMonth: "1998-08-15T09:00:00.000Z",
    nextYear: "1999-03-02T14:00:00.000Z",
    preEpoch: "1969-07-20T20:17:40.000Z",
  };

  for (const [name, occurredAt] of Object.entries(occurrences)) {
    const momentId = await createMoment(directory.pool, owner.userId, { occurredAt });

    OWN[name] = momentId;

    await project(
      { momentId, authorUserId: owner.userId, occurredAt, visibility: "public" },
      [{ type: "person", id: owner.userId }],
    );
  }

  // The friend's own, private, with the owner an accepted participant. On the
  // owner's Timeline because they agreed to be; unreadable because agreeing
  // granted them nothing.
  WITHHELD = await createMoment(directory.pool, friend.userId, {
    occurredAt: "1998-07-15T10:00:00.000Z",
    visibility: "private",
  });

  await directory.pool.query(
    `INSERT INTO moment_participations (participation_id, moment_id, user_id, status, proposed_at, resolved_at)
     VALUES ($1, $2, $3, 'accepted', now(), now())`,
    [randomUUID(), WITHHELD, owner.userId],
  );
  await project(
    {
      momentId: WITHHELD,
      authorUserId: friend.userId,
      occurredAt: "1998-07-15T10:00:00.000Z",
      visibility: "private",
    },
    [
      { type: "person", id: owner.userId },
      { type: "person", id: friend.userId },
    ],
  );
});

afterAll(async () => {
  await store.client.command({
    query: `ALTER TABLE timeline_moment_contexts DELETE WHERE projection_version = '${VERSION}'`,
    clickhouse_settings: { mutations_sync: "2" },
  });
  await store.client.command({
    query: `ALTER TABLE timeline_moments DELETE WHERE projection_version = '${VERSION}'`,
    clickhouse_settings: { mutations_sync: "2" },
  });
  await removePeople(directory.pool, people);
  await app.close();
  await store.close();
  await directory.close();
});

describe("reading a stretch of history span by span", () => {
  it("returns one span per month that holds anything, oldest first", async () => {
    const { body } = await ask(
      DISTRIBUTION,
      { view: spanning(owner.userId, "1998-01-01T00:00:00Z", "1998-12-31T00:00:00Z"), scale: "MONTH" },
      owner.token,
    );
    const buckets = bucketsOf(body);

    assert.deepEqual(
      buckets.map((bucket) => bucket.startsAt),
      ["1998-07-01T00:00:00.000Z", "1998-08-01T00:00:00.000Z"],
    );
  });

  it("leaves out the months nothing happened in", async () => {
    // A client draws those itself, from the scale and the interval. Sending
    // zeros would make the answer's size a function of the range asked for.
    const { body } = await ask(
      DISTRIBUTION,
      { view: spanning(owner.userId, "1998-01-01T00:00:00Z", "1998-12-31T00:00:00Z"), scale: "MONTH" },
      owner.token,
    );

    assert.equal(bucketsOf(body).length, 2);
  });

  it("says how coarsely it read, and over what interval", async () => {
    const { body } = await ask(
      DISTRIBUTION,
      { view: spanning(owner.userId, "1998-01-01T00:00:00Z", "1998-12-31T00:00:00Z"), scale: "MONTH" },
      owner.token,
    );
    const answer = (body.data as never as { temporalDistribution: Record<string, unknown> })
      .temporalDistribution;

    assert.equal(answer.scale, "MONTH");
    assert.equal(answer.from, "1998-01-01T00:00:00.000Z");
    assert.equal(answer.to, "1998-12-31T00:00:00.000Z");
    assert.deepEqual(answer.scope, { type: "PERSON", id: owner.userId });
  });

  it("puts every representative inside the span carrying it", async () => {
    // The claim the whole cross-store design rests on, asserted where a failure
    // is visible rather than arithmetic.
    for (const scale of ["DAY", "WEEK", "MONTH", "YEAR"] as const) {
      const { body } = await ask(
        DISTRIBUTION,
        { view: spanning(owner.userId, "1998-01-01T00:00:00Z", "1998-12-31T00:00:00Z"), scale },
        owner.token,
      );

      for (const bucket of bucketsOf(body)) {
        const start = new Date(bucket.startsAt).getTime();

        for (const representative of bucket.representatives) {
          const at = new Date(
            (representative as unknown as { occurredAt: string }).occurredAt,
          ).getTime();

          assert.ok(
            at >= start,
            `at ${scale}, a representative from ${new Date(at).toISOString()} sits in the span beginning ${bucket.startsAt}`,
          );
        }
      }
    }
  });

  it("counts the same history however coarsely it is read", async () => {
    // Months nest into their year, which is the arithmetic proof that both
    // stores bucket the same instants the same way.
    const view = spanning(owner.userId, "1998-01-01T00:00:00Z", "1998-12-31T00:00:00Z");
    const byMonth = bucketsOf((await ask(DISTRIBUTION, { view, scale: "MONTH" }, owner.token)).body);
    const byYear = bucketsOf((await ask(DISTRIBUTION, { view, scale: "YEAR" }, owner.token)).body);
    const summed = byMonth.reduce((total, bucket) => total + bucket.count, 0);

    assert.equal(byYear.length, 1);
    assert.equal(byYear[0]?.count, summed);
  });

  it("reads history from before the epoch, where the calendar functions fail", async () => {
    const { body } = await ask(
      DISTRIBUTION,
      { view: spanning(owner.userId, "1969-01-01T00:00:00Z", "1969-12-31T00:00:00Z"), scale: "WEEK" },
      owner.token,
    );
    const buckets = bucketsOf(body);

    // 1969-07-20 was a Sunday; its week began on the Monday before.
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0]?.startsAt, "1969-07-14T00:00:00.000Z");
    assert.equal(buckets[0]?.representatives[0]?.momentId, OWN.preEpoch);
  });

  it("resolves a rolling range against the instant the request arrived", async () => {
    const { body } = await ask(
      DISTRIBUTION,
      {
        view: { scope: { type: "PERSON", id: owner.userId }, range: { rolling: { unit: "DAY", count: 30 } } },
        scale: "DAY",
      },
      owner.token,
    );
    const answer = (body.data as never as { temporalDistribution: { from: string; to: string } })
      .temporalDistribution;
    const window = new Date(answer.to).getTime() - new Date(answer.from).getTime();

    assert.equal(body.errors, undefined);
    assert.equal(Math.round(window / 86_400_000), 30);
  });
});

describe("a count and a representative answer different questions", () => {
  it("counts a Moment the owner may not read, and never offers it as a representative", async () => {
    const { body } = await ask(
      DISTRIBUTION,
      { view: spanning(owner.userId, "1998-07-01T00:00:00Z", "1998-07-31T00:00:00Z"), scale: "MONTH" },
      owner.token,
    );
    const july = bucketsOf(body)[0];

    // Three Moments in July: two of the owner's own and the friend's private
    // one. The count includes it, because paging this Timeline returns it
    // redacted rather than removing it — a count and its page must agree.
    assert.equal(july?.count, 3);

    // One per person per span, and never the one they may not read.
    const offered = july?.representatives.map((one) => one.momentId) ?? [];

    assert.ok(!offered.includes(WITHHELD));
    assert.equal(offered.length, 1);
  });

  it("shows a stranger neither the count of it nor the Moment", async () => {
    const { body } = await ask(
      DISTRIBUTION,
      { view: spanning(owner.userId, "1998-07-01T00:00:00Z", "1998-07-31T00:00:00Z"), scale: "MONTH" },
      stranger.token,
    );
    const july = bucketsOf(body)[0];

    // Every other Timeline filters rather than reports: what the stranger may
    // not see is absent from the count as well as from the representatives.
    assert.equal(july?.count, 2);
    assert.ok(!(july?.representatives ?? []).some((one) => one.momentId === WITHHELD));
  });
});

describe("history at its extremes", () => {
  it("caps a dense span at three, from three different people", async () => {
    // Twenty-four Moments in one month, from eight people. The count reports all
    // of them; the span still speaks with three voices.
    const reader = await signedInPerson();
    const authors: string[] = [];

    for (let person = 0; person < 8; person += 1) {
      const author = await createPerson(directory.pool);

      people.push(author);
      authors.push(author.userId);

      for (let each = 0; each < 3; each += 1) {
        const occurredAt = `1986-04-${String(each * 7 + 1).padStart(2, "0")}T12:00:00.000Z`;
        const momentId = await createMoment(directory.pool, author.userId, { occurredAt });

        await project(
          { momentId, authorUserId: author.userId, occurredAt, visibility: "public" },
          [{ type: "person", id: reader.userId }],
        );
        await directory.pool.query(
          `INSERT INTO moment_participations (participation_id, moment_id, user_id, status, proposed_at, resolved_at)
           VALUES ($1, $2, $3, 'accepted', now(), now())`,
          [randomUUID(), momentId, reader.userId],
        );
      }
    }

    const { body } = await ask(
      DISTRIBUTION,
      { view: spanning(reader.userId, "1986-01-01T00:00:00Z", "1986-12-31T00:00:00Z"), scale: "MONTH" },
      reader.token,
    );
    const april = bucketsOf(body)[0];

    assert.equal(april?.count, 24);
    assert.equal(april?.representatives.length, 3);
  });

  it("answers a single Moment in a century without pretending the rest is there", async () => {
    const reader = await signedInPerson();
    const occurredAt = "1923-11-08T20:00:00.000Z";
    const momentId = await createMoment(directory.pool, reader.userId, { occurredAt });

    await project(
      { momentId, authorUserId: reader.userId, occurredAt, visibility: "public" },
      [{ type: "person", id: reader.userId }],
    );

    const { body } = await ask(
      DISTRIBUTION,
      { view: spanning(reader.userId, "1900-01-01T00:00:00Z", "1999-12-31T00:00:00Z"), scale: "YEAR" },
      reader.token,
    );
    const buckets = bucketsOf(body);

    // One span out of a hundred years. The other ninety-nine are the client's to
    // draw, from the scale and the interval, and are not ninety-nine rows here.
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0]?.startsAt, "1923-01-01T00:00:00.000Z");
    assert.equal(buckets[0]?.count, 1);
    assert.equal(buckets[0]?.representatives[0]?.momentId, momentId);
  });
});

describe("what a distribution costs", () => {
  it("asks PostgreSQL nothing at all when nobody wanted representatives", async () => {
    const view = spanning(owner.userId, "1998-01-01T00:00:00Z", "1998-12-31T00:00:00Z");
    const withThem = await ask(DISTRIBUTION, { view, scale: "MONTH" }, owner.token);
    const without = await ask(COUNTS_ONLY, { view, scale: "MONTH" }, owner.token);

    assert.equal(withThem.body.errors, undefined);
    assert.equal(without.body.errors, undefined);
    assert.equal(withThem.cost - without.cost, 1);
  });

  it("costs the same whether it covers two spans or three hundred and sixty-five", async () => {
    // The assertion this exists for. Magnitude is a judgement; growth is a fact,
    // and a `representatives` field resolved per span would move this number.
    const view = spanning(owner.userId, "1998-01-01T00:00:00Z", "1998-12-31T00:00:00Z");
    const coarse = await ask(DISTRIBUTION, { view, scale: "YEAR" }, owner.token);
    const fine = await ask(DISTRIBUTION, { view, scale: "DAY" }, owner.token);

    assert.equal(coarse.body.errors, undefined);
    assert.equal(fine.body.errors, undefined);
    assert.equal(fine.cost, coarse.cost);
  });
});

describe("what a distribution refuses", () => {
  it("refuses a view naming no stretch of time", async () => {
    const { body } = await ask(
      DISTRIBUTION,
      { view: { scope: { type: "PERSON", id: owner.userId } }, scale: "DAY" },
      owner.token,
    );

    assert.match(body.errors?.[0]?.message ?? "", /stretch of time/);
  });

  it("refuses a decade read day by day, and says how to ask instead", async () => {
    const { body } = await ask(
      DISTRIBUTION,
      { view: spanning(owner.userId, "1990-01-01T00:00:00Z", "1999-12-31T00:00:00Z"), scale: "DAY" },
      owner.token,
    );

    assert.match(body.errors?.[0]?.message ?? "", /week by week/);
  });

  it("refuses somebody who offered no credential", async () => {
    // Reading history requires an account. Asserted here rather than assumed
    // from the shared resolver, because a new root field is exactly where that
    // requirement gets forgotten.
    const response = await app.inject({
      method: "POST",
      url: "/graphql",
      payload: {
        query: DISTRIBUTION,
        variables: {
          view: spanning(owner.userId, "1998-01-01T00:00:00Z", "1998-12-31T00:00:00Z"),
          scale: "MONTH",
        },
      },
    });
    const body = response.json() as { data: unknown; errors?: { message: string }[] };

    assert.ok(body.errors !== undefined && body.errors.length > 0);
  });

  it("refuses a stretch reaching before history is held", async () => {
    const { body } = await ask(
      DISTRIBUTION,
      { view: spanning(owner.userId, "1850-01-01T00:00:00Z", "1899-12-31T00:00:00Z"), scale: "DECADE" },
      owner.token,
    );

    assert.match(body.errors?.[0]?.message ?? "", /1900/);
  });
});
