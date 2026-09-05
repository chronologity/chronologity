import DataLoader from "dataloader";
import type { Logger } from "../observability/logger.js";
import type {
  CommentPageKey,
  CommentRow,
  MomentReadModel,
  Slice,
} from "../read-models/postgres/moment-read-model.js";
import { recordBatch } from "../observability/metrics.js";

/**
 * Reading several pages of discussion in one statement.
 *
 * **The case this exists for.** Replies are read by naming their thread rather
 * than through a field on a comment, because a connection per comment would have
 * been one query per row of a page. That moved the problem from the server to
 * the document: a hundred-comment discussion whose replies a client wants is a
 * hundred selections, and was a hundred statements. It is now one per level.
 *
 * The row shape does not change, so nothing that composes a discussion knows
 * this happened.
 */

/**
 * How many pages one dispatch may ask for.
 *
 * A discussion page is capped at a hundred by contract, and the motivating case
 * is exactly one such page with every comment asking for its replies — so a
 * hundred is the shape a legitimate request actually has. Above it, DataLoader
 * splits into consecutive statements rather than refusing: how large a statement
 * may be is a different question from how large a document may be, and the
 * second belongs to admission control.
 */
const MOST = 100;

/**
 * What makes two page requests the same request.
 *
 * `limit` is in the key because two page sizes are two answers. The cursor is in
 * it whole, identifier included, because two comments can share an instant and
 * only the pair names a position.
 *
 * @param key - The page being asked for.
 * @returns A stable string for keys that must share one answer.
 */
export function cacheKeyFor(key: CommentPageKey): string {
  const resume =
    key.after === undefined ? "" : `${key.after.createdAt.toISOString()}:${key.after.commentId}`;

  return `${key.moment.row.moment_id}|${key.thread ?? ""}|${key.limit}|${resume}`;
}

/**
 * Build the request's discussion loader.
 *
 * @param moments - Where a discussion is read from.
 * @param log - Already bound to this request.
 * @returns A loader over page requests. A thread with nothing in it resolves to
 *   an empty page rather than to nothing: an empty discussion is an answer.
 * @throws {Error} From a dispatch whose keys were not all proven for the same
 *   reader. Not degradable and not per key — `AuthorizedMoment` records who
 *   proved it, so a mixed batch means something structural is wrong, and
 *   finishing the response would be worse than failing it.
 */
export function createCommentPageLoader(
  moments: MomentReadModel,
  log: Logger,
): DataLoader<CommentPageKey, Slice<CommentRow>, string> {
  return new DataLoader<CommentPageKey, Slice<CommentRow>, string>(
    async (keys) => {
      const began = Date.now();
      const readers = new Set(keys.map((key) => key.moment.viewerUserId));

      if (readers.size > 1) {
        throw new Error("One dispatch carried pages proven for more than one reader");
      }

      const pages = await moments.commentPages(keys as readonly CommentPageKey[]);
      // One statement per level present, which is what makes the split visible
      // rather than folklore.
      const levels = new Set(keys.map((key) => key.thread === undefined));

      log.debug(
        {
          loader: "comment-page",
          keys: keys.length,
          statements: levels.size,
          durationMs: Date.now() - began,
        },
        "batched",
      );
      // The same fact as a metric, which is what `feed.md:1289` asked for. The
      // log line stays: a log says which request, a metric says how often.
      recordBatch("comment-page", keys.length);

      return pages;
    },
    { maxBatchSize: MOST, cacheKeyFn: cacheKeyFor },
  );
}
