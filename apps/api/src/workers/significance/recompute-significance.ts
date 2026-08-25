import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import {
  GLOBAL_SCOPE_ID,
  type MomentSignificanceRepository,
  type ScoredSignificance,
  type SignificanceInputs,
} from "../../features/moments/moment-significance.repository.js";
import {
  ALGORITHM_VERSION,
  scoreCausal,
  scoreCollective,
  scoreEvent,
  scoreEvidentiary,
  scorePersonal,
  scoreRetrospective,
  scoreStructural,
  scoreTemporal,
} from "../../features/moments/significance.scoring.js";

/**
 * Keeping derived significance up to date with the history it describes.
 *
 * Asynchronous on purpose. `historical-significance.md:206` permits computing
 * recursive significance "asynchronously, incrementally, periodically, or
 * through another scalable mechanism", and says plainly that not every causal
 * relationship should trigger a synchronous recalculation — a Moment gaining a
 * descendant may change the reading of history six generations upstream.
 *
 * Periodic rather than event-driven because nothing publishes the events that
 * would drive it, and inventing those events here would fix a shape 5Q has not
 * decided. Invariant 45 permits eventual consistency for exactly this reason.
 *
 * **Nothing here can see engagement.** Neither this module nor the repository it
 * uses reaches reactions or comments, which is what the architecture constraints
 * ask for: engagement must stay separable so a later optimization cannot quietly
 * turn attention into importance.
 */

export interface RecomputeOptions {
  readonly dataSource: DataSource;
  readonly significance: MomentSignificanceRepository;
  /** How many Moments to reassess at once. */
  readonly batchSize?: number;
  readonly now?: () => Date;
}

export interface RecomputeResult {
  /** How many Moments were reassessed. */
  readonly reassessed: number;
  /**
   * Whether the pass ran out of work rather than out of batch.
   *
   * Every Moment is always reassessable, so this is never true in the way an
   * outbox drains — it means the batch was not filled, which only happens when
   * there are fewer Moments than the batch size.
   */
  readonly reachedEnd: boolean;
}

const DEFAULT_BATCH_SIZE = 100;

/**
 * Score one Moment across every scope it belongs to.
 *
 * A Moment does not have a significance; it has one per history it is part of.
 * `historical-significance.md:76` is explicit that `Significance(Moment,
 * Context)` is the better model, so the same Moment may be unremarkable
 * globally and among the most consequential things in one family's record.
 *
 * @param inputs - Everything read about the Moment.
 * @returns Every value it now scores, before baselines are resolved.
 */
export function scoreEverything(inputs: SignificanceInputs): ScoredSignificance[] {
  const causal = scoreCausal(inputs.causal);

  const scored: ScoredSignificance[] = [
    // Global: what the shape of history says, regardless of whose it is.
    { scopeType: "global", scopeId: GLOBAL_SCOPE_ID, dimension: "causal", value: causal, provenance: "graph" },
    {
      scopeType: "global",
      scopeId: GLOBAL_SCOPE_ID,
      dimension: "structural",
      value: scoreStructural(inputs.structural),
      provenance: "graph",
    },
    {
      scopeType: "global",
      scopeId: GLOBAL_SCOPE_ID,
      dimension: "evidentiary",
      value: scoreEvidentiary(inputs.evidentiary),
      provenance: "graph",
    },
    // The author's own record, which is the scope a boundary is a boundary of.
    {
      scopeType: "person",
      scopeId: inputs.authorUserId,
      dimension: "temporal",
      value: scoreTemporal(inputs.temporal),
      provenance: "rule",
    },
  ];

  // One row per person who said it matters to them, in their own scope. Summing
  // these would make a private mark into a public tally, and invariant 12 says a
  // mark establishes nothing about universal importance.
  for (const userId of inputs.markedBy) {
    scored.push({
      scopeType: "person",
      scopeId: userId,
      dimension: "personal",
      value: scorePersonal(true),
      provenance: "human",
    });
  }

  for (const eventId of inputs.eventIds) {
    scored.push({
      scopeType: "real_world_event",
      scopeId: eventId,
      dimension: "event",
      value: scoreEvent(inputs.event),
      provenance: "graph",
    });
    scored.push({
      scopeType: "real_world_event",
      scopeId: eventId,
      dimension: "collective",
      value: scoreCollective(inputs.collective),
      provenance: "graph",
    });
  }

  for (const locationId of inputs.locationIds) {
    scored.push({
      scopeType: "location",
      scopeId: locationId,
      dimension: "collective",
      value: scoreCollective(inputs.collective),
      provenance: "graph",
    });
  }

  return scored;
}

/**
 * Reassess a batch of Moments, stalest first.
 *
 * @param options - The database, the repository, and how many to take.
 * @returns How many were reassessed, and whether the batch filled.
 */
export async function recomputeSignificanceBatch(
  options: RecomputeOptions,
): Promise<RecomputeResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const momentIds = await options.significance.claimStalest(batchSize);

  for (const momentId of momentIds) {
    await recomputeSignificanceFor(options, momentId);
  }

  return { reassessed: momentIds.length, reachedEnd: momentIds.length < batchSize };
}

/**
 * Reassess one Moment.
 *
 * Separate from the batch so that a caller with a reason to reassess something
 * specific need not sweep everything to reach it — which is what a test wants,
 * and what an on-demand recomputation would want if one is ever added.
 *
 * @param options - The database and the repository.
 * @param momentId - Which Moment.
 * @returns Whether it was reassessed. False means there is no such Moment, or it
 *   has been deleted, which is not an error: the sweep may reach a Moment that
 *   went away while it was working.
 */
export async function recomputeSignificanceFor(
  options: RecomputeOptions,
  momentId: string,
): Promise<boolean> {
  const now = options.now ?? (() => new Date());
  const inputs = await options.significance.inputsFor(momentId);

  if (inputs === undefined) {
    return false;
  }

  const baselines = await options.significance.baselinesFor(momentId);
  const scored = scoreEverything(inputs);

  // Retrospective significance is not a separate analysis. It is how far causal
  // significance has risen since it was first assessed, which is only visible
  // because the baseline was kept.
  const causal = scored.find((row) => row.dimension === "causal" && row.scopeType === "global");

  if (causal !== undefined) {
    const baseline = baselines.get(`global|${GLOBAL_SCOPE_ID}|causal`) ?? causal.value;

    scored.push({
      scopeType: "global",
      scopeId: GLOBAL_SCOPE_ID,
      dimension: "retrospective",
      value: scoreRetrospective(causal.value, baseline),
      provenance: "graph",
    });
  }

  const withBaselines = scored.map((row) => ({
    ...row,
    // Kept across recomputation, or set from this assessment when there was
    // none. Overwriting it would erase the only evidence that later history
    // changed anything.
    baselineValue: baselines.get(`${row.scopeType}|${row.scopeId}|${row.dimension}`) ?? row.value,
  }));

  await withTransaction(options.dataSource, (tx) =>
    options.significance.replace(tx, momentId, withBaselines, ALGORITHM_VERSION, now()),
  );

  return true;
}
