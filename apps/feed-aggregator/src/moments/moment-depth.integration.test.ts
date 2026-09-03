import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { MomentReadModel } from "../read-models/postgres/moment-read-model.js";
import { testAppConfig } from "../testing/app-config.js";
import {
  attachMedia,
  createComment,
  createMoment,
  createPerson,
  createPlace,
  moderate,
  removePeople,
  type Person,
} from "../testing/moment-fixtures.js";

/**
 * Reading a Moment, against the tables it is actually read from.
 *
 * The first time this service touches authoritative state, and the questions it
 * settles cannot be settled anywhere else: whether the statements this
 * application writes match the columns the API's migrations created, and whether
 * the rule that decides what a Viewer may see behaves the same way through `pg`
 * as it does through TypeORM.
 *
 * The matrix below is the point of the suite. Every row of it is a way somebody
 * can be refused, and each is refused identically — a Moment that does not exist
 * and a Moment somebody may not have look the same from outside, because telling
 * them apart discloses which applied.
 */

const config = testAppConfig();

let directory: Directory;
let moments: MomentReadModel;
const people: Person[] = [];

/** Somebody new, remembered so the suite can take them away again. */
const person = async (over: { status?: string; bornYearsAgo?: number } = {}): Promise<Person> => {
  const created = await createPerson(directory.pool, over);

  people.push(created);

  return created;
};

/** Whether this reader may have this Moment at all. */
const canRead = async (momentId: string, viewer: Person, isAdult = true): Promise<boolean> =>
  (await moments.findVisible(momentId, viewer.userId, isAdult)) !== undefined;

/** The Moment, insisting it came back. */
const read = async (momentId: string, viewer: Person, isAdult = true) => {
  const found = await moments.findVisible(momentId, viewer.userId, isAdult);

  assert.ok(found, "the Moment was withheld from a reader who should have had it");

  return found;
};

beforeAll(async () => {
  directory = createDirectory(config.database);

  const present = await directory.pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.moments') IS NOT NULL AS exists",
  );

  if (present.rows[0]?.exists !== true) {
    throw new Error("The schema is missing. The API owns it: run `pnpm db:migrate` and try again.");
  }

  moments = new MomentReadModel(directory.pool);
});

afterAll(async () => {
  await removePeople(directory.pool, people);
  await directory.close();
});

describe("whether a Moment may be had at all", () => {
  it("gives somebody their own history, whatever state it is in", async () => {
    const author = await person();
    const momentId = await createMoment(directory.pool, author.userId, { visibility: "private" });

    assert.equal(await canRead(momentId, author), true);
  });

  it("gives a stranger a public Moment", async () => {
    const author = await person();
    const stranger = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    assert.equal(await canRead(momentId, stranger), true);
  });

  it("withholds a private Moment from everybody else", async () => {
    const author = await person();
    const stranger = await person();
    const momentId = await createMoment(directory.pool, author.userId, { visibility: "private" });

    assert.equal(await canRead(momentId, stranger), false);
  });

  it("gives a restricted Moment to somebody it names", async () => {
    const author = await person();
    const named = await person();
    const momentId = await createMoment(directory.pool, author.userId, {
      visibility: "restricted",
    });

    await directory.pool.query(
      "INSERT INTO moment_audience (moment_id, user_id) VALUES ($1, $2)",
      [momentId, named.userId],
    );

    assert.equal(await canRead(momentId, named), true);
  });

  it("withholds a restricted Moment from somebody it does not name", async () => {
    const author = await person();
    const stranger = await person();
    const momentId = await createMoment(directory.pool, author.userId, {
      visibility: "restricted",
    });

    assert.equal(await canRead(momentId, stranger), false);
  });

  it("withholds a Moment from somebody the author blocked", async () => {
    const author = await person();
    const blocked = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await directory.pool.query(
      "INSERT INTO user_blocks (blocker_user_id, blocked_user_id, created_at) VALUES ($1, $2, now())",
      [author.userId, blocked.userId],
    );

    assert.equal(await canRead(momentId, blocked), false);
  });

  it("withholds it the other way round too", async () => {
    // Asymmetry would let the blocked person infer the Block from history that
    // stopped appearing one way only.
    const author = await person();
    const blocker = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await directory.pool.query(
      "INSERT INTO user_blocks (blocker_user_id, blocked_user_id, created_at) VALUES ($1, $2, now())",
      [blocker.userId, author.userId],
    );

    assert.equal(await canRead(momentId, blocker), false);
  });

  it("withholds a suspended author's history from everybody else", async () => {
    const author = await person({ status: "suspended" });
    const stranger = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    assert.equal(await canRead(momentId, stranger), false);
  });

  it("still gives a suspended person their own history", async () => {
    // Somebody who cannot see what was hidden cannot meaningfully appeal it.
    const author = await person({ status: "suspended" });
    const momentId = await createMoment(directory.pool, author.userId);

    assert.equal(await canRead(momentId, author), true);
  });

  it("withholds what was removed", async () => {
    const author = await person();
    const stranger = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await moderate(directory.pool, "moment", momentId, "removed");

    assert.equal(await canRead(momentId, stranger), false);
  });

  it("withholds what was taken down pending a decision", async () => {
    const author = await person();
    const stranger = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await moderate(directory.pool, "moment", momentId, "temporarily_unavailable");

    assert.equal(await canRead(momentId, stranger), false);
  });

  it("withholds age-restricted history from somebody too young", async () => {
    const author = await person();
    const child = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await moderate(directory.pool, "moment", momentId, "age_restricted");

    assert.equal(await canRead(momentId, child, false), false);
  });

  it("gives age-restricted history to an adult", async () => {
    const author = await person();
    const adult = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await moderate(directory.pool, "moment", momentId, "age_restricted");

    assert.equal(await canRead(momentId, adult, true), true);
  });

  it("keeps showing a Moment that was only warned about", async () => {
    // `warned` hides nothing from a direct reader. The line is between
    // existing, being reachable, and being promoted.
    const author = await person();
    const stranger = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await moderate(directory.pool, "moment", momentId, "warned");

    assert.equal(await canRead(momentId, stranger), true);
  });

  it("answers nothing for a Moment that does not exist", async () => {
    // Indistinguishable from every refusal above, which is the point.
    const stranger = await person();

    assert.equal(await canRead(randomUUID(), stranger), false);
  });
});

describe("what comes back with a Moment", () => {
  it("carries its caption, its author and when it happened", async () => {
    const author = await person();
    const momentId = await createMoment(directory.pool, author.userId, {
      caption: "the day the power came back",
    });

    const found = await read(momentId, author);

    assert.equal(found.row.caption, "the day the power came back");
    assert.equal(found.row.handle, author.handle);
    assert.equal(found.row.occurrence_precision, "instant");
    assert.equal(found.row.occurrence_offset_minutes, 60);
  });

  it("carries the place whole, for the composer to reduce", async () => {
    const author = await person();
    const momentId = await createMoment(directory.pool, author.userId, {
      locationDisclosure: "city",
    });

    await createPlace(directory.pool, momentId, author.userId);

    const found = await read(momentId, author);

    assert.equal(found.row.location_name, "Madison Square Garden");
    assert.equal(found.row.city, "New York");
    assert.equal(found.row.location_disclosure, "city");
  });

  it("carries no place when nobody said where", async () => {
    const author = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    assert.equal((await read(momentId, author)).row.location_id, null);
  });
});

describe("the significance mark", () => {
  it("is this reader's own", async () => {
    const author = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await directory.pool.query(
      "INSERT INTO moment_personal_significance (moment_id, user_id, marked_at) VALUES ($1, $2, now())",
      [momentId, author.userId],
    );

    assert.notEqual((await read(momentId, author)).row.marked_at, null);
  });

  it("is never anybody else's", async () => {
    // The guarantee lives in the join condition rather than in a mapping step,
    // so there is no path through the code that could return somebody else's.
    const author = await person();
    const stranger = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await directory.pool.query(
      "INSERT INTO moment_personal_significance (moment_id, user_id, marked_at) VALUES ($1, $2, now())",
      [momentId, author.userId],
    );

    assert.equal((await read(momentId, stranger)).row.marked_at, null);
  });
});

describe("a Moment's media", () => {
  it("comes back in the order its author arranged it", async () => {
    const author = await person();
    const momentId = await createMoment(directory.pool, author.userId);
    const uploads = await attachMedia(directory.pool, momentId, author.userId, 3);

    const page = await moments.media(await read(momentId, author), 10, undefined);

    assert.deepEqual(
      page.rows.map((row) => row.upload_id),
      uploads,
    );
  });

  it("pages without a short page in the middle", async () => {
    const author = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await attachMedia(directory.pool, momentId, author.userId, 7);

    const found = await read(momentId, author);
    const seen: string[] = [];
    let after: number | undefined;

    for (let page = 0; page < 4; page += 1) {
      const slice = await moments.media(found, 3, after);

      if (slice.rows.length === 0) {
        break;
      }

      // Every page but the last holds what was asked for. A page thinned after
      // the fact would leak through its size.
      if (slice.more) {
        assert.equal(slice.rows.length, 3);
      }

      seen.push(...slice.rows.map((row) => row.upload_id));
      after = slice.rows[slice.rows.length - 1]?.position;
    }

    assert.equal(seen.length, 7);
    assert.equal(new Set(seen).size, 7, "a Moment's media repeated across pages");
  });

  it("reports what a decoder found rather than what was declared", async () => {
    const author = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await attachMedia(directory.pool, momentId, author.userId, 1, "video");

    const page = await moments.media(await read(momentId, author), 10, undefined);

    assert.equal(page.rows[0]?.kind, "video");
    assert.equal(Number(page.rows[0]?.duration_seconds), 12.5);
    assert.deepEqual(page.rows[0]?.derivatives, ["thumbnail"]);
  });
});

describe("a Moment's discussion", () => {
  it("comes back oldest first", async () => {
    // The one list that does not run newest first: showing the beginning
    // preserves the context that makes later replies comprehensible.
    const author = await person();
    const talker = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    const first = await createComment(directory.pool, momentId, talker.userId, {
      body: "first",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const second = await createComment(directory.pool, momentId, talker.userId, {
      body: "second",
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    const page = await moments.comments(await read(momentId, author), 10, undefined, undefined);

    assert.deepEqual(
      page.rows.map((row) => row.comment_id),
      [first, second],
    );
  });

  it("hides a blocked person's words, in either direction", async () => {
    const author = await person();
    const blocked = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await createComment(directory.pool, momentId, blocked.userId);
    await directory.pool.query(
      "INSERT INTO user_blocks (blocker_user_id, blocked_user_id, created_at) VALUES ($1, $2, now())",
      [author.userId, blocked.userId],
    );

    const page = await moments.comments(await read(momentId, author), 10, undefined, undefined);

    assert.deepEqual(page.rows, []);
  });

  it("keeps a deleted comment that still has replies, and drops one that does not", async () => {
    const author = await person();
    const talker = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    const answered = await createComment(directory.pool, momentId, talker.userId, {
      deleted: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    await createComment(directory.pool, momentId, talker.userId, {
      threadCommentId: answered,
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    await createComment(directory.pool, momentId, talker.userId, {
      deleted: true,
      createdAt: "2026-01-03T00:00:00.000Z",
    });

    const page = await moments.comments(await read(momentId, author), 10, undefined, undefined);

    assert.deepEqual(
      page.rows.map((row) => row.comment_id),
      [answered],
    );
  });

  it("reads a thread's replies when one is named", async () => {
    const author = await person();
    const talker = await person();
    const momentId = await createMoment(directory.pool, author.userId);
    const thread = await createComment(directory.pool, momentId, talker.userId);
    const reply = await createComment(directory.pool, momentId, talker.userId, {
      threadCommentId: thread,
    });

    const page = await moments.comments(await read(momentId, author), 10, undefined, thread);

    assert.deepEqual(
      page.rows.map((row) => row.comment_id),
      [reply],
    );
  });

  it("counts what a reader may see, excluding tombstones and including replies", async () => {
    const author = await person();
    const talker = await person();
    const momentId = await createMoment(directory.pool, author.userId);
    const thread = await createComment(directory.pool, momentId, talker.userId);

    await createComment(directory.pool, momentId, talker.userId, { threadCommentId: thread });
    await createComment(directory.pool, momentId, talker.userId, { deleted: true });

    assert.equal(await moments.commentCount(await read(momentId, author)), 2);
  });

  it("gathers mentions and responses without a statement each", async () => {
    const author = await person();
    const talker = await person();
    const momentId = await createMoment(directory.pool, author.userId);
    const commentId = await createComment(directory.pool, momentId, talker.userId);

    await directory.pool.query(
      "INSERT INTO comment_mentions (comment_id, user_id, created_at) VALUES ($1, $2, now())",
      [commentId, author.userId],
    );
    await directory.pool.query(
      "INSERT INTO comment_reactions (comment_id, user_id, kind, created_at, updated_at) VALUES ($1, $2, 'loved', now(), now())",
      [commentId, author.userId],
    );

    const page = await moments.comments(await read(momentId, author), 10, undefined, undefined);

    assert.deepEqual(page.rows[0]?.mentions, [{ userId: author.userId, handle: author.handle }]);
    assert.deepEqual(page.rows[0]?.counts, [{ kind: "loved", count: 1 }]);
    assert.equal(page.rows[0]?.yours, "loved");
  });
});

describe("how a Moment has been responded to", () => {
  it("counts each kind", async () => {
    const author = await person();
    const admirer = await person();
    const momentId = await createMoment(directory.pool, author.userId);

    await directory.pool.query(
      "INSERT INTO moment_reactions (moment_id, user_id, kind) VALUES ($1, $2, 'loved'), ($1, $3, 'loved')",
      [momentId, author.userId, admirer.userId],
    );

    const counted = await moments.reactions(await read(momentId, author));

    assert.deepEqual([...counted], [{ kind: "loved", count: 2, mine: true }]);
  });

  it("leaves a suspended person out of the count and still tells them their own", async () => {
    // The reason suspension filters the count rather than the rows. In the
    // `WHERE` their row would vanish before the aggregate saw it.
    const author = await person();
    const suspended = await person({ status: "suspended" });
    const momentId = await createMoment(directory.pool, author.userId);

    await directory.pool.query(
      "INSERT INTO moment_reactions (moment_id, user_id, kind) VALUES ($1, $2, 'amused')",
      [momentId, suspended.userId],
    );

    const forOthers = await moments.reactions(await read(momentId, author));
    const forThemselves = await moments.reactions(await read(momentId, suspended));

    assert.deepEqual([...forOthers], [{ kind: "amused", count: 0, mine: false }]);
    assert.deepEqual([...forThemselves], [{ kind: "amused", count: 0, mine: true }]);
  });
});

describe("what a Moment is connected to", () => {
  it("reads a claim from either end", async () => {
    const author = await person();
    const from = await createMoment(directory.pool, author.userId);
    const to = await createMoment(directory.pool, author.userId);

    await directory.pool.query(
      `INSERT INTO moment_relationships (relationship_id, source_moment_id, target_moment_id,
                                         kind, origin, asserted_by_user_id)
       VALUES ($1, $2, $3, 'led_to', 'asserted', $4)`,
      [randomUUID(), from, to, author.userId],
    );

    const forwards = await moments.relationships(await read(from, author), true, 10);
    const backwards = await moments.relationships(await read(to, author), true, 10);

    assert.equal(forwards.length, 1);
    assert.equal(backwards.length, 1);
  });

  it("omits a claim whose far end privacy withholds", async () => {
    // An identifier pointing at an inaccessible Moment is itself a disclosure.
    const author = await person();
    const stranger = await person();
    const shown = await createMoment(directory.pool, author.userId);
    const hidden = await createMoment(directory.pool, author.userId, { visibility: "private" });

    await directory.pool.query(
      `INSERT INTO moment_relationships (relationship_id, source_moment_id, target_moment_id,
                                         kind, origin, asserted_by_user_id)
       VALUES ($1, $2, $3, 'related_to', 'asserted', $4)`,
      [randomUUID(), shown, hidden, author.userId],
    );

    assert.deepEqual([...(await moments.relationships(await read(shown, stranger), true, 10))], []);
  });

  it("marks a claim whose far end moderation withheld, rather than omitting it", async () => {
    // A chain should keep its shape, and Chronologity admitting its own act
    // discloses nothing about anybody else.
    const author = await person();
    const stranger = await person();
    const shown = await createMoment(directory.pool, author.userId);
    const withheld = await createMoment(directory.pool, author.userId);

    await moderate(directory.pool, "moment", withheld, "removed");
    await directory.pool.query(
      `INSERT INTO moment_relationships (relationship_id, source_moment_id, target_moment_id,
                                         kind, origin, asserted_by_user_id)
       VALUES ($1, $2, $3, 'contributed_to', 'asserted', $4)`,
      [randomUUID(), shown, withheld, author.userId],
    );

    const claims = await moments.relationships(await read(shown, stranger), true, 10);

    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.unavailable, true);
  });
});
