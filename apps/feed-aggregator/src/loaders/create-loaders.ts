import type DataLoader from "dataloader";
import type { RequestEligibility } from "../auth/request-eligibility.js";
import type { Logger } from "../observability/logger.js";
import type {
  AuthorizedMoment,
  CommentPageKey,
  CommentRow,
  MomentReadModel,
  Slice,
} from "../read-models/postgres/moment-read-model.js";
import { createCommentPageLoader } from "./comment-page.loader.js";
import { createMomentLoader } from "./moment.loader.js";

/**
 * What one request batches and deduplicates.
 *
 * **Built per request, and the Viewer is what makes that structural rather than
 * conventional.** The read models are built once for the process because they
 * hold a connection and nothing about who is asking. These hold the request's
 * eligibility, and eligibility exists only inside the closure that receives a
 * request — so a loader cannot be hoisted to process scope by accident, because
 * there is nothing there to build it from. The mistake does not fail a review;
 * it fails to compile.
 *
 * That matters because a shared loader leaks in three ways, only the first of
 * which any access check would catch: a Moment its reader may not see; a Moment
 * they may see carrying somebody else's private significance mark, joined into
 * the row by the Viewer's own identifier; and a decision that has since been
 * revoked, replayed after the fact.
 *
 * **Nothing here outlives the request, so nothing here needs invalidating.**
 * That is the whole reason request-scoped batching comes before any cache: a
 * cache that survives a request inherits erasure, correction, privacy change and
 * moderation as obligations, and this inherits none of them by construction.
 */
export interface RequestLoaders {
  /** Moments, read once each however often a request names one. */
  readonly moment: DataLoader<string, AuthorizedMoment | undefined>;
  /** Pages of discussion, read one statement per level. */
  readonly commentPage: DataLoader<CommentPageKey, Slice<CommentRow>, string>;
}

/**
 * Build the loaders one request will use.
 *
 * @param moments - The process-wide read model both loaders read through.
 * @param eligibility - This request's Viewer.
 * @param log - Already bound to this request, so every dispatch it makes can be
 *   found beside the query that caused it.
 * @returns Loaders holding no state from any other request.
 */
export function createLoaders(
  moments: MomentReadModel,
  eligibility: RequestEligibility,
  log: Logger,
): RequestLoaders {
  return {
    moment: createMomentLoader(moments, eligibility, log),
    commentPage: createCommentPageLoader(moments, log),
  };
}

/**
 * Load one key, and do not remember a failure.
 *
 * DataLoader clears a batch's keys when the batch function itself rejects, but
 * **caches an `Error` returned for a single key** — measured against the
 * installed version rather than assumed. Left cached, one transient failure is
 * replayed to every later reader in the request, turning a failed round trip
 * into a response that cannot be composed at all. This is what
 * `RequestEligibility` already does for the same reason: a failed lookup is not
 * an answer.
 *
 * @param loader - The loader to read through.
 * @param key - What to read.
 * @returns The value.
 * @throws {Error} Whatever the read threw, after forgetting it.
 */
export async function load<K, V, C>(loader: DataLoader<K, V, C>, key: K): Promise<V> {
  try {
    return await loader.load(key);
  } catch (error) {
    loader.clear(key);

    throw error;
  }
}
