import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createDirectory, type Directory } from "./client.js";
import { MomentReadModel, type AuthorizedMoment, type CommentPageKey } from "./moment-read-model.js";
import { testAppConfig } from "../../testing/app-config.js";
import {
  createComment,
  createMoment,
  createPerson,
  moderate,
  removePeople,
  type Person,
} from "../../testing/moment-fixtures.js";

/**
 * Reading many at once against reading one at a time.
 *
 * **The claim is that nothing moved.** Batching restructured the discussion
 * statement — the page is now chosen inside a lateral and the enrichment joins
 * hang off that result rather than off the whole candidate set — and a
 * restructure that changed a row would be invisible in a statement count and
 * loud only much later. So every case is read both ways and compared whole.
 *
 * "One at a time" is a batch of one, which is the honest comparison: the same
 * code, asked differently. What is proved is that the ordinal partitioning and
 * the per-key limit put each key's rows where they belong.
 */

const config = testAppConfig();

let directory: Directory;
let moments: MomentReadModel;
let author: Person;
let reader: Person;
let authorized: AuthorizedMoment;
let threads: string[] = [];

const people: Person[] = [];

/** Read each key on its own, as the service did before batching. */
const oneAtATime = async (keys: readonly CommentPageKey[]) =>
  Promise.all(keys.map(async (key) => (await moments.commentPages([key]))[0]));

beforeAll(async () => {
  directory = createDirectory(config.database);
  moments = new MomentReadModel(directory.pool);

  const present = await directory.pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.moments') IS NOT NULL AS exists",
  );

  if (present.rows[0]?.exists !== true) {
    throw new Error("The schema is missing. The API owns it: run `pnpm db:migrate` and try again.");
  }

  author = await createPerson(directory.pool);
  reader = await createPerson(directory.pool);
  people.push(author, reader);

  const momentId = await createMoment(directory.pool, author.userId);
  const found = await moments.findVisible(momentId, reader.userId, true);

  assert.ok(found, "the fixture Moment is not readable");
  authorized = found;

  for (let index = 0; index < 6; index += 1) {
    const thread = await createComment(directory.pool, momentId, author.userId, {
      body: `top ${index}`,
      createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
    });

    threads.push(thread);

    for (let reply = 0; reply < 4; reply += 1) {
      await createComment(directory.pool, momentId, author.userId, {
        body: `reply ${index}.${reply}`,
        threadCommentId: thread,
        createdAt: `2026-02-0${index + 1}T0${reply}:00:00.000Z`,
      });
    }
  }

  // A tombstone that still has a live reply, so it must survive; and one that
  // does not, so it must not.
  const carried = await createComment(directory.pool, momentId, author.userId, {
    body: "gone but load-bearing",
    createdAt: "2026-01-07T00:00:00.000Z",
    deleted: true,
  });

  await createComment(directory.pool, momentId, author.userId, {
    body: "still here",
    threadCommentId: carried,
    createdAt: "2026-02-07T00:00:00.000Z",
  });
  await createComment(directory.pool, momentId, author.userId, {
    body: "gone entirely",
    createdAt: "2026-01-08T00:00:00.000Z",
    deleted: true,
  });

  threads = [...threads, carried];
});

afterAll(async () => {
  await removePeople(directory.pool, people);
  await directory.close();
});

describe("a batch of pages against the same pages one at a time", () => {
  it("returns the same replies for every thread", async () => {
    const keys: CommentPageKey[] = threads.map((thread) => ({
      moment: authorized,
      limit: 10,
      after: undefined,
      thread,
    }));

    assert.deepEqual(await moments.commentPages(keys), await oneAtATime(keys));
  });

  it("keeps the two levels apart when both are in one batch", async () => {
    // Splitting by level is an optimisation for two partial indexes; it must not
    // be visible in the answer.
    const keys: CommentPageKey[] = [
      { moment: authorized, limit: 5, after: undefined, thread: undefined },
      { moment: authorized, limit: 5, after: undefined, thread: threads[0] as string },
      { moment: authorized, limit: 5, after: undefined, thread: threads[1] as string },
    ];
    const batched = await moments.commentPages(keys);

    assert.deepEqual(batched, await oneAtATime(keys));
    assert.ok(batched[0]?.rows.every((row) => row.thread_comment_id === null));
    assert.ok(batched[1]?.rows.every((row) => row.thread_comment_id === threads[0]));
  });

  it("gives each key its own page size", async () => {
    // Two keys naming the same thread, differing only in how many they want.
    // Nothing but the ordinal tells their rows apart.
    const keys: CommentPageKey[] = [
      { moment: authorized, limit: 1, after: undefined, thread: threads[0] as string },
      { moment: authorized, limit: 3, after: undefined, thread: threads[0] as string },
    ];
    const batched = await moments.commentPages(keys);

    assert.equal(batched[0]?.rows.length, 1);
    assert.equal(batched[1]?.rows.length, 3);
    assert.deepEqual(batched, await oneAtATime(keys));
  });

  it("resumes each key from its own cursor", async () => {
    const opening = (
      await moments.commentPages([
        { moment: authorized, limit: 2, after: undefined, thread: threads[0] as string },
      ])
    )[0];
    const last = opening?.rows[1];

    assert.ok(last);

    const keys: CommentPageKey[] = [
      {
        moment: authorized,
        limit: 2,
        after: { createdAt: last.created_at, commentId: last.comment_id },
        thread: threads[0] as string,
      },
      { moment: authorized, limit: 2, after: undefined, thread: threads[1] as string },
    ];
    const batched = await moments.commentPages(keys);

    assert.deepEqual(batched, await oneAtATime(keys));
    assert.ok(!batched[0]?.rows.some((row) => row.comment_id === last.comment_id));
  });

  it("answers the same at the probe boundary either side of it", async () => {
    // Each thread has four replies. Asking for three, four and five must report
    // "there is more" correctly, and no key may borrow another's row to decide.
    for (const limit of [3, 4, 5]) {
      const keys: CommentPageKey[] = [
        { moment: authorized, limit, after: undefined, thread: threads[0] as string },
        { moment: authorized, limit, after: undefined, thread: threads[1] as string },
      ];

      assert.deepEqual(await moments.commentPages(keys), await oneAtATime(keys), `limit ${limit}`);
    }
  });

  it("carries a tombstone with live replies and drops one without", async () => {
    const page = (
      await moments.commentPages([
        { moment: authorized, limit: 50, after: undefined, thread: undefined },
      ])
    )[0];
    const bodies = page?.rows.map((row) => row.body) ?? [];

    assert.ok(!bodies.includes("gone entirely"));
    assert.equal(
      page?.rows.some((row) => row.deleted_at !== null),
      true,
    );
  });

  it("answers an empty thread rather than nothing at all", async () => {
    const keys: CommentPageKey[] = [
      { moment: authorized, limit: 5, after: undefined, thread: randomUUID() },
      { moment: authorized, limit: 5, after: undefined, thread: threads[0] as string },
    ];
    const batched = await moments.commentPages(keys);

    assert.deepEqual(batched[0], { rows: [], more: false });
    assert.ok((batched[1]?.rows.length ?? 0) > 0);
    assert.deepEqual(batched, await oneAtATime(keys));
  });

  it("withholds a moderated comment in a batch exactly as it does alone", async () => {
    const hidden = await createComment(directory.pool, authorized.row.moment_id, author.userId, {
      body: "removed",
      createdAt: "2026-01-09T00:00:00.000Z",
    });

    await moderate(directory.pool, "comment", hidden, "removed");

    const keys: CommentPageKey[] = [
      { moment: authorized, limit: 50, after: undefined, thread: undefined },
    ];
    const batched = await moments.commentPages(keys);

    assert.deepEqual(batched, await oneAtATime(keys));
    assert.ok(!batched[0]?.rows.some((row) => row.comment_id === hidden));
  });
});

describe("many Moments against one Moment", () => {
  it("agrees with the singular read, key by key", async () => {
    const visible = authorized.row.moment_id;
    const withheld = await createMoment(directory.pool, author.userId, { visibility: "private" });
    const erased = await createMoment(directory.pool, author.userId);

    await directory.pool.query("UPDATE moments SET deleted_at = now() WHERE moment_id = $1", [
      erased,
    ]);

    const ids = [visible, withheld, erased, randomUUID()];
    const many = await moments.findVisibleMany(ids, reader.userId, true);

    for (const id of ids) {
      assert.deepEqual(many.get(id), await moments.findVisible(id, reader.userId, true), id);
    }

    // Only the readable one came back, and a refusal is still an absence.
    assert.deepEqual([...many.keys()], [visible]);
  });

  it("asks about none without asking the database anything", async () => {
    assert.deepEqual(await moments.findVisibleMany([], reader.userId, true), new Map());
  });
});
