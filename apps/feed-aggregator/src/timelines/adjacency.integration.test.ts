import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  asClickHouseDateTime,
  TimelineEligibilityResolver,
  type TimelineScopeRef,
} from "@chronologity/timeline-derivation";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ContextAxisReadModel } from "../read-models/clickhouse/context-axis-read-model.js";
import { createReadStore, type ReadStore } from "../read-models/clickhouse/client.js";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { asQueryable } from "../read-models/postgres/queryable.js";
import type { AppConfig } from "../config/app-config.js";
import { testAppConfig } from "../testing/app-config.js";
import { createPerson, removePeople, type Person } from "../testing/moment-fixtures.js";

/**
 * What the horizontal axis will and will not say.
 *
 * The reason this phase needs an integration suite. An edge on the axis is a
 * claim that two stretches of history are connected, and every way somebody
 * could be told that wrongly is a disclosure: a Moment they may not read, a
 * person they were not told was there, a place whose author withheld it.
 *
 * The rules are enforced inside the statements, so only a real query against
 * real rows can show they hold.
 */

const VERSION = `test-${randomUUID().slice(0, 8)}`;
const base = testAppConfig();
const config: AppConfig = {
  ...base,
  clickhouse: { ...base.clickhouse, projectionVersion: VERSION },
};

let store: ReadStore;
let directory: Directory;
let axis: ContextAxisReadModel;
let eligibility: TimelineEligibilityResolver;
const people: Person[] = [];

const PLACE = randomUUID();
const OCCASION = randomUUID();
const ELSEWHERE = randomUUID();

const place = (id = PLACE): TimelineScopeRef => ({ type: "location", id });

/** Somebody new, remembered so the suite can take them away again. */
const person = async (over: { status?: string } = {}): Promise<Person> => {
  const created = await createPerson(directory.pool, over);

  people.push(created);

  return created;
};

/**
 * Project one Moment into the contexts it belongs to.
 *
 * Straight into the projection rather than through the projector, because what
 * is under test is what the axis makes of these rows.
 *
 * @param moment - Which Moment, whose it is, and how visible.
 * @param contexts - Every context it belongs to, people included where a test
 *   needs to prove they never surface.
 * @returns Nothing.
 */
async function project(
  moment: {
    momentId: string;
    authorUserId: string;
    occurredAt: string;
    visibility?: string;
    moderationState?: string;
  },
  contexts: readonly { type: string; id: string }[],
): Promise<void> {
  await store.client.insert({
    table: "timeline_moment_contexts",
    values: contexts.map((context) => ({
      context_type: context.type,
      context_id: context.id,
      occurred_at: asClickHouseDateTime(new Date(moment.occurredAt)),
      moment_id: moment.momentId,
      author_user_id: moment.authorUserId,
      visibility: moment.visibility ?? "public",
      moderation_state: moment.moderationState ?? "allowed",
      projected_at: asClickHouseDateTime(new Date()),
      projection_version: VERSION,
    })),
    format: "JSONEachRow",
  });
}

/** What the axis says is next to a place, for this reader. */
const sharedWith = async (viewer: Person, scope = place()): Promise<string[]> => {
  const resolved = await eligibility.resolve(viewer.userId, scope);
  const slice = await axis.sharedHistory(scope, resolved, 50, undefined);

  return slice.rows.map((row) => `${row.context_type}:${row.context_id}`);
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

  axis = new ContextAxisReadModel(store.client, VERSION);
  eligibility = new TimelineEligibilityResolver(asQueryable(directory.pool));
});

afterAll(async () => {
  await removePeople(directory.pool, people);

  // Queued rather than awaited: a lightweight delete waits for the mutation to
  // be applied everywhere, and nothing but this run reads this version.
  await store.client.command({
    query: `DELETE FROM timeline_moment_contexts WHERE projection_version = {version: String}`,
    query_params: { version: VERSION },
    clickhouse_settings: { lightweight_deletes_sync: "0" },
  });

  await store.close();
  await directory.close();
});

describe("what shares history with a place", () => {
  it("finds an occasion a readable Moment also belongs to", async () => {
    const author = await person();
    const reader = await person();

    await project(
      { momentId: randomUUID(), authorUserId: author.userId, occurredAt: "2020-01-01T00:00:00Z" },
      [place(), { type: "real_world_event", id: OCCASION }],
    );

    assert.ok((await sharedWith(reader)).includes(`real_world_event:${OCCASION}`));
  });

  it("counts a context once however many Moments it shares", async () => {
    const author = await person();
    const reader = await person();
    const anchor = randomUUID();
    const occasion = randomUUID();

    for (let index = 0; index < 12; index += 1) {
      await project(
        {
          momentId: randomUUID(),
          authorUserId: author.userId,
          occurredAt: `2021-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
        },
        [place(anchor), { type: "real_world_event", id: occasion }],
      );
    }

    const found = await sharedWith(reader, place(anchor));

    assert.deepEqual(found, [`real_world_event:${occasion}`]);
  });

  it("never returns the place somebody is already standing in", async () => {
    const author = await person();
    const reader = await person();
    const anchor = randomUUID();

    await project(
      { momentId: randomUUID(), authorUserId: author.userId, occurredAt: "2020-01-01T00:00:00Z" },
      [place(anchor), { type: "real_world_event", id: randomUUID() }],
    );

    assert.ok(!(await sharedWith(reader, place(anchor))).includes(`location:${anchor}`));
  });
});

describe("an edge only exists through history the reader may see", () => {
  const hiddenBy = async (
    over: { visibility?: string; moderationState?: string; suspendAuthor?: boolean },
    readerIsBlocked = false,
  ): Promise<string[]> => {
    const author = await person(over.suspendAuthor === true ? { status: "suspended" } : {});
    const reader = await person();
    const anchor = randomUUID();
    const occasion = randomUUID();

    if (readerIsBlocked) {
      await directory.pool.query(
        "INSERT INTO user_blocks (blocker_user_id, blocked_user_id, created_at) VALUES ($1, $2, now())",
        [author.userId, reader.userId],
      );
    }

    await project(
      {
        momentId: randomUUID(),
        authorUserId: author.userId,
        occurredAt: "2020-01-01T00:00:00Z",
        ...over,
      },
      [place(anchor), { type: "real_world_event", id: occasion }],
    );

    return sharedWith(reader, place(anchor));
  };

  it("draws none through a private Moment", async () => {
    assert.deepEqual(await hiddenBy({ visibility: "private" }), []);
  });

  it("draws none through a restricted Moment the reader is not named in", async () => {
    assert.deepEqual(await hiddenBy({ visibility: "restricted" }), []);
  });

  it("draws none through a blocked author's Moment", async () => {
    assert.deepEqual(await hiddenBy({}, true), []);
  });

  it("draws none through a Moment taken down pending a decision", async () => {
    assert.deepEqual(await hiddenBy({ moderationState: "temporarily_unavailable" }), []);
  });

  it("draws none through age-restricted history for somebody too young", async () => {
    const author = await person();
    const child = await person();
    const anchor = randomUUID();

    await project(
      {
        momentId: randomUUID(),
        authorUserId: author.userId,
        occurredAt: "2020-01-01T00:00:00Z",
        moderationState: "age_restricted",
      },
      [place(anchor), { type: "real_world_event", id: randomUUID() }],
    );

    // Resolved rather than asserted: nobody here has a recorded birthdate, so
    // the rule denies, which is what deny-by-default means.
    const resolved = await eligibility.resolve(child.userId, place(anchor));

    assert.equal(resolved.isAdult, false);
    assert.deepEqual((await axis.sharedHistory(place(anchor), resolved, 50, undefined)).rows, []);
  });

  it("still draws one for the author of their own withheld history", async () => {
    const author = await person();
    const anchor = randomUUID();
    const occasion = randomUUID();

    await project(
      {
        momentId: randomUUID(),
        authorUserId: author.userId,
        occurredAt: "2020-01-01T00:00:00Z",
        visibility: "private",
      },
      [place(anchor), { type: "real_world_event", id: occasion }],
    );

    assert.deepEqual(await sharedWith(author, place(anchor)), [`real_world_event:${occasion}`]);
  });
});

describe("people are never on the axis", () => {
  it("leaves out a Moment's author", async () => {
    const author = await person();
    const reader = await person();
    const anchor = randomUUID();

    await project(
      { momentId: randomUUID(), authorUserId: author.userId, occurredAt: "2020-01-01T00:00:00Z" },
      [place(anchor), { type: "person", id: author.userId }],
    );

    assert.deepEqual(await sharedWith(reader, place(anchor)), []);
  });

  it("leaves out somebody who merely took part", async () => {
    // The sharp case. A Moment's accepted participants are not its author, so
    // the eligibility rule admits the row — and surfacing them would assert who
    // was there, which Moment depth deliberately never says.
    const author = await person();
    const participant = await person();
    const reader = await person();
    const anchor = randomUUID();
    const momentId = randomUUID();

    await project(
      { momentId, authorUserId: author.userId, occurredAt: "2020-01-01T00:00:00Z" },
      [
        place(anchor),
        { type: "person", id: author.userId },
        { type: "person", id: participant.userId },
      ],
    );

    const found = await sharedWith(reader, place(anchor));

    assert.ok(!found.some((one) => one.startsWith("person:")));
    assert.ok(!JSON.stringify(found).includes(participant.userId));
  });
});

describe("the same period", () => {
  it("reaches contexts that share no history at all", async () => {
    // The property this phase was redrawn for: the axis does not run out.
    const author = await person();
    const reader = await person();
    const anchor = randomUUID();

    await project(
      { momentId: randomUUID(), authorUserId: author.userId, occurredAt: "2019-01-01T00:00:00Z" },
      [place(anchor)],
    );
    await project(
      { momentId: randomUUID(), authorUserId: author.userId, occurredAt: "2018-01-01T00:00:00Z" },
      [place(ELSEWHERE)],
    );

    const resolved = await eligibility.resolve(reader.userId, place(anchor));
    const slice = await axis.samePeriod(
      place(anchor),
      resolved,
      new Date("2026-01-01T00:00:00Z"),
      50,
      undefined,
    );

    assert.ok(
      slice.rows.some((row) => row.context_id === ELSEWHERE),
      "a context sharing no history was unreachable",
    );
  });

  it("never repeats what the first tier already answered for", async () => {
    const author = await person();
    const reader = await person();
    const anchor = randomUUID();
    const occasion = randomUUID();

    await project(
      { momentId: randomUUID(), authorUserId: author.userId, occurredAt: "2020-01-01T00:00:00Z" },
      [place(anchor), { type: "real_world_event", id: occasion }],
    );

    const resolved = await eligibility.resolve(reader.userId, place(anchor));
    const slice = await axis.samePeriod(
      place(anchor),
      resolved,
      new Date("2026-01-01T00:00:00Z"),
      50,
      undefined,
    );

    assert.ok(!slice.rows.some((row) => row.context_id === occasion));
    assert.ok(!slice.rows.some((row) => row.context_id === anchor));
  });

  it("reaches nothing after the point being looked at", async () => {
    const author = await person();
    const reader = await person();
    const anchor = randomUUID();
    const later = randomUUID();

    await project(
      { momentId: randomUUID(), authorUserId: author.userId, occurredAt: "2030-01-01T00:00:00Z" },
      [place(later)],
    );

    const resolved = await eligibility.resolve(reader.userId, place(anchor));
    const slice = await axis.samePeriod(
      place(anchor),
      resolved,
      new Date("2020-01-01T00:00:00Z"),
      50,
      undefined,
    );

    assert.ok(!slice.rows.some((row) => row.context_id === later));
  });
});
