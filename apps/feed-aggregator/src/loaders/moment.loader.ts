import DataLoader from "dataloader";
import type { RequestEligibility } from "../auth/request-eligibility.js";
import type { Logger } from "../observability/logger.js";
import type { AuthorizedMoment, MomentReadModel } from "../read-models/postgres/moment-read-model.js";

/**
 * Reading Moments once each, however often a request asks.
 *
 * **Deduplication here is a correctness property, and the saved statement is the
 * side effect.** Two selections of the same Moment in one document — which
 * aliases make ordinary — each ran the visibility check separately. Between the
 * two the author can change who may see it, block the reader, or delete it; a
 * moderator can withhold it. The response could then carry one selection
 * answered and the other null: a single document asserting both that its reader
 * may see that Moment and that they may not. That is not a slow answer, it is a
 * wrong one, and it is the failure ADR-142 named — "four chances for one of them
 * to disagree mid-response". ADR-142 closed it beneath a Moment; nothing then
 * reached the same Moment twice.
 *
 * After this, one request holds one answer to "may this reader see this Moment",
 * for every Moment it reads, for its whole life.
 */

/** How many Moments one statement may ask about. */
const MOST = 200;

/**
 * Build the request's Moment loader.
 *
 * **Takes the request's eligibility rather than resolved facts**, so building it
 * performs no I/O and cannot throw: the context it lives on is built for every
 * request including ones that read no history, and Mercurius rebuilds that
 * context from inside its own error handler.
 *
 * @param moments - Where a Moment is read from.
 * @param eligibility - This request's Viewer, resolved on first use and once.
 * @param log - Already bound to this request, so a dispatch can be found beside
 *   the query that caused it.
 * @returns A loader whose keys are Moment identifiers. A Moment this reader may
 *   not see resolves to `undefined`, never to an error — a refusal and a Moment
 *   that never existed are deliberately the same answer.
 */
export function createMomentLoader(
  moments: MomentReadModel,
  eligibility: RequestEligibility,
  log: Logger,
): DataLoader<string, AuthorizedMoment | undefined> {
  return new DataLoader<string, AuthorizedMoment | undefined>(
    async (momentIds) => {
      const began = Date.now();
      const facts = await eligibility.forViewer();
      const found = await moments.findVisibleMany(
        momentIds as readonly string[],
        facts.viewerUserId,
        facts.isAdult,
      );

      // Positional, and the order is the caller's rather than the store's. A
      // batch answered in the order rows happened to come back would hand each
      // caller somebody else's Moment — silently, and only when the fixture was
      // not already sorted.
      // The shape and never the keys: a Moment identifier is exactly what the
      // logger redacts from query variables, and an array of them here would
      // walk around the redaction it exists to enforce.
      log.debug(
        { loader: "moment", keys: momentIds.length, statements: 1, durationMs: Date.now() - began },
        "batched",
      );

      return momentIds.map((momentId) => found.get(momentId));
    },
    { maxBatchSize: MOST },
  );
}
