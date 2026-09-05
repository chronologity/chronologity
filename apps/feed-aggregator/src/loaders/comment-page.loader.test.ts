import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import type { Logger } from "../observability/logger.js";
import type {
  AuthorizedMoment,
  CommentPageKey,
  MomentReadModel,
  MomentRow,
} from "../read-models/postgres/moment-read-model.js";
import { cacheKeyFor, createCommentPageLoader } from "./comment-page.loader.js";

/**
 * Reading several pages of discussion at once.
 *
 * What matters here is which requests are *the same request*. Two selections
 * differing only in how many replies they want are two answers, and a key that
 * conflated them would hand one of them the other's page.
 */

const VIEWER = randomUUID();
const OTHER = randomUUID();
const LOG = { debug: () => undefined } as unknown as Logger;

const momentOf = (viewerUserId = VIEWER): AuthorizedMoment =>
  ({ row: { moment_id: randomUUID() } as MomentRow, viewerUserId });

const MOMENT = momentOf();

const key = (over: Partial<CommentPageKey> = {}): CommentPageKey => ({
  moment: MOMENT,
  limit: 10,
  after: undefined,
  thread: undefined,
  ...over,
});

/** A read model that records the keys of each dispatch. */
const readModel = (asked: CommentPageKey[][]): MomentReadModel =>
  ({
    commentPages: async (keys: readonly CommentPageKey[]) => {
      asked.push([...keys]);

      return keys.map(() => ({ rows: [], more: false }));
    },
  }) as unknown as MomentReadModel;

describe("what makes two page requests the same request", () => {
  it("treats identical requests as one", () => {
    assert.equal(cacheKeyFor(key()), cacheKeyFor(key()));
  });

  it("keeps two page sizes apart", () => {
    // Two answers, not one. A shared key would give the larger request the
    // smaller one's page.
    assert.notEqual(cacheKeyFor(key({ limit: 5 })), cacheKeyFor(key({ limit: 50 })));
  });

  it("keeps two threads apart", () => {
    assert.notEqual(
      cacheKeyFor(key({ thread: randomUUID() })),
      cacheKeyFor(key({ thread: randomUUID() })),
    );
  });

  it("keeps the opening page apart from a resumed one", () => {
    assert.notEqual(
      cacheKeyFor(key()),
      cacheKeyFor(key({ after: { createdAt: new Date("2026-01-01T00:00:00Z"), commentId: randomUUID() } })),
    );
  });

  it("keeps two cursors sharing an instant apart", () => {
    // Two comments can be written in the same millisecond, and only the pair
    // names a position.
    const createdAt = new Date("2026-01-01T00:00:00.000Z");

    assert.notEqual(
      cacheKeyFor(key({ after: { createdAt, commentId: randomUUID() } })),
      cacheKeyFor(key({ after: { createdAt, commentId: randomUUID() } })),
    );
  });
});

describe("dispatching a batch of pages", () => {
  it("asks once for several threads wanted in the same tick", async () => {
    const asked: CommentPageKey[][] = [];
    const loader = createCommentPageLoader(readModel(asked), LOG);
    const threads = [randomUUID(), randomUUID(), randomUUID()];

    await Promise.all(threads.map(async (thread) => loader.load(key({ thread }))));

    assert.equal(asked.length, 1);
    assert.equal(asked[0]?.length, 3);
  });

  it("asks once for the same page wanted twice", async () => {
    const asked: CommentPageKey[][] = [];
    const loader = createCommentPageLoader(readModel(asked), LOG);
    const thread = randomUUID();

    await Promise.all([loader.load(key({ thread })), loader.load(key({ thread }))]);

    assert.equal(asked[0]?.length, 1);
  });

  it("carries both page sizes when two requests differ only in that", async () => {
    const asked: CommentPageKey[][] = [];
    const loader = createCommentPageLoader(readModel(asked), LOG);
    const thread = randomUUID();

    await Promise.all([
      loader.load(key({ thread, limit: 1 })),
      loader.load(key({ thread, limit: 30 })),
    ]);

    assert.deepEqual(
      asked[0]?.map((one) => one.limit),
      [1, 30],
    );
  });

  it("refuses a dispatch carrying pages proven for two different readers", async () => {
    // Not degradable and not per key: a Moment records who proved it, so a mixed
    // dispatch means something structural is wrong, and finishing the response
    // would be worse than failing it.
    const loader = createCommentPageLoader(readModel([]), LOG);

    await assert.rejects(
      Promise.all([
        loader.load(key({ moment: momentOf(VIEWER) })),
        loader.load(key({ moment: momentOf(OTHER) })),
      ]),
      /more than one reader/,
    );
  });
});
