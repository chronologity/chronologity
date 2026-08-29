import type { DataSource } from "typeorm";
import {
  describeAccount,
  describeComment,
  describeMoment,
  describePerson,
  describeParticipation,
  describeReaction,
} from "../../features/privacy/export-document.js";
import type { ExportSourceRepository } from "../../features/privacy/export-source.repository.js";
import {
  classifyFailure,
  DEFAULT_BACKOFF_MS,
  DEFAULT_LEASE_MS,
  DEFAULT_MAXIMUM_ATTEMPTS,
  DEFAULT_MOMENTS_PER_PART,
  DEFAULT_RETENTION_DAYS,
  expiresAt,
  partName,
  partsNeeded,
  retryAfter,
  stateAfterFailure,
} from "../../features/privacy/export.policy.js";
import type {
  ClaimedExport,
  ExportRepository,
} from "../../features/privacy/export.repository.js";
import type { StorageClient } from "../../integrations/storage/storage-client.js";
import { withTransaction } from "../../lib/database/transaction.js";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * Assembling somebody's history into something they can keep.
 *
 * A worker for the reason every long-running thing here is one: a Moment may
 * hold an unlimited number of images and videos, and by extension a history
 * holds an unlimited number of Moments. `product/privacy.md:784` asks for
 * asynchronous preparation, chunking, and a manifest, and this is all three.
 *
 * **It writes data and never media.** The photographs and videos are signed
 * from the originals when somebody downloads, so preparing an export does not
 * duplicate a single byte of anybody's media. The only new copy this creates is
 * the JSON — which is why this worker also sweeps: that copy has an expiry, and
 * something has to enforce it.
 */

export interface ExportBuildOptions {
  readonly dataSource: DataSource;
  readonly exports: ExportRepository;
  readonly sources: ExportSourceRepository;
  readonly storage: StorageClient;
  /** Where exports are written, beneath which each gets its own prefix. */
  readonly prefix?: string;
  readonly batchSize?: number;
  readonly momentsPerPart?: number;
  readonly retentionDays?: number;
  readonly maximumAttempts?: number;
  readonly backoffMs?: number;
  readonly leaseMs?: number;
  readonly now?: () => Date;
  readonly logger?: Logger;
}

export interface ExportBuildResult {
  readonly prepared: number;
  /** Failed this time, and still owed. */
  readonly retrying: number;
  readonly failed: number;
  readonly abandoned: number;
  /** Prepared exports whose life ran out, and whose objects are now gone. */
  readonly swept: number;
  readonly reachedEnd: boolean;
}

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_PREFIX = "exports";
const SWEEP_BATCH_SIZE = 20;

/**
 * Prepare one batch of exports, and sweep any that have run out.
 *
 * @param options - Database, repositories, storage, and settings.
 * @returns How many were prepared, retried, failed, abandoned, and swept, and
 *   whether the queue is now empty.
 * @throws {Error} If the database could not be reached while claiming. A
 *   failure building one export is recorded against its request and does not
 *   stop the others.
 */
export async function buildDueExports(
  options: ExportBuildOptions,
): Promise<ExportBuildResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const now = options.now ?? (() => new Date());
  const at = now();

  const claimed = await withTransaction(options.dataSource, (tx) =>
    options.exports.claimDue(tx, at, batchSize, options.leaseMs ?? DEFAULT_LEASE_MS),
  );

  const tally = { prepared: 0, retrying: 0, failed: 0, abandoned: 0 };

  for (const request of claimed) {
    tally[await buildOne(options, request, at)] += 1;
  }

  const swept = await sweepExpired(options, at);

  return { ...tally, swept, reachedEnd: claimed.length < batchSize };
}

/**
 * Prepare one export, and record what happened.
 *
 * @param options - Repositories, storage, and settings.
 * @param request - The claimed request.
 * @param at - The instant this pass began.
 * @returns What became of it.
 */
async function buildOne(
  options: ExportBuildOptions,
  request: ClaimedExport,
  at: Date,
): Promise<"prepared" | "retrying" | "failed" | "abandoned"> {
  const prefix = `${options.prefix ?? DEFAULT_PREFIX}/${request.userId}/${request.requestId}`;

  try {
    const partCount = await writeExport(options, request.userId, prefix);

    await withTransaction(options.dataSource, (tx) =>
      options.exports.markReady(tx, request.requestId, {
        storagePrefix: prefix,
        partCount,
        at,
        expiresAt: expiresAt(at, options.retentionDays ?? DEFAULT_RETENTION_DAYS),
      }),
    );

    // Whatever the last export left behind goes now. Two copies of somebody's
    // history where they asked for one is the failure this sweep prevents, and
    // waiting for the older one's own expiry would leave both standing for
    // days.
    await removeSuperseded(options, request.userId, request.requestId);

    return "prepared";
  } catch (error) {
    const category = classifyFailure(error);
    const state = stateAfterFailure(
      category,
      request.attempts,
      options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS,
    );

    options.logger?.[state === "pending" ? "warn" : "error"](
      {
        requestId: request.requestId,
        attempts: request.attempts,
        category,
        err: error instanceof Error ? error.message : String(error),
      },
      state === "pending" ? "Export failed and will be retried" : "Export will not be retried",
    );

    await withTransaction(options.dataSource, (tx) =>
      options.exports.recordFailure(tx, request.requestId, {
        state,
        category,
        error: error instanceof Error ? error.message : String(error),
        at,
        retryAt: retryAfter(at, request.attempts, options.backoffMs ?? DEFAULT_BACKOFF_MS),
      }),
    );

    return state === "pending" ? "retrying" : state;
  }
}

/**
 * Write the account's history to object storage, in parts.
 *
 * @param options - Repositories and storage.
 * @param userId - Whose history.
 * @param prefix - Where to write it.
 * @returns How many parts were written, always at least one.
 * @throws {Error} If a store refused, for the caller to classify.
 */
async function writeExport(
  options: ExportBuildOptions,
  userId: string,
  prefix: string,
): Promise<number> {
  const perPart = options.momentsPerPart ?? DEFAULT_MOMENTS_PER_PART;
  const account = await options.sources.account(userId);

  if (account === undefined) {
    // Nothing to export and nothing that will change. Classified as permanent
    // by the constraint-violation rule below would be wrong, so it is said
    // plainly here.
    throw Object.assign(new Error("No such account"), { name: "QueryFailedError" });
  }

  const total = await options.sources.momentCount(userId);
  const count = partsNeeded(total, perPart);

  for (let index = 1; index <= count; index += 1) {
    const moments = await options.sources.moments(userId, perPart, (index - 1) * perPart);

    // The first part carries everything that is not a Moment. Putting the
    // account, the relationships and the moderation history in one place means
    // somebody with a large history does not have to read every part to find
    // out who they were.
    const part =
      index === 1
        ? {
            exportedAt: new Date().toISOString(),
            account: describeAccount(account),
            relationships: await relationships(options, userId),
            comments: (await options.sources.comments(userId)).map(describeComment),
            reactions: (await options.sources.reactions(userId)).map(describeReaction),
            participations: (await options.sources.participations(userId)).map(
              describeParticipation,
            ),
            moderation: (await options.sources.moderation(userId)).map((decision) => ({
              subjectType: decision.subjectType,
              subjectId: decision.subjectId,
              state: decision.state,
              reason: decision.reason,
              decidedAt: decision.decidedAt.toISOString(),
            })),
            moments: moments.map(describeMoment),
          }
        : { moments: moments.map(describeMoment) };

    await options.storage.put(
      `${prefix}/${partName(index)}`,
      new TextEncoder().encode(JSON.stringify(part, null, 2)),
      "application/json",
    );
  }

  return count;
}

/**
 * Who the account is connected to, everybody by handle.
 *
 * @param options - Where the reads happen.
 * @param userId - Whose.
 * @returns The three lists.
 */
async function relationships(
  options: ExportBuildOptions,
  userId: string,
): Promise<Record<string, ReturnType<typeof describePerson>[]>> {
  const found = await options.sources.relationships(userId);

  return {
    following: found.following.map(describePerson),
    followers: found.followers.map(describePerson),
    blocked: found.blocked.map(describePerson),
  };
}

/**
 * Remove what an account's previous exports left in storage.
 *
 * @param options - Repositories and storage.
 * @param userId - Whose.
 * @param exceptRequestId - The export just prepared.
 * @returns Nothing.
 */
async function removeSuperseded(
  options: ExportBuildOptions,
  userId: string,
  exceptRequestId: string,
): Promise<void> {
  for (const old of await options.exports.supersededExports(userId, exceptRequestId)) {
    await removeObjects(options, old.storagePrefix);

    await withTransaction(options.dataSource, (tx) =>
      options.exports.markExpired(tx, old.requestId),
    );
  }
}

/**
 * Remove prepared exports whose life has run out.
 *
 * @param options - Repositories and storage.
 * @param at - The instant to judge against.
 * @returns How many were swept.
 */
async function sweepExpired(options: ExportBuildOptions, at: Date): Promise<number> {
  const expired = await options.exports.expiredExports(at, SWEEP_BATCH_SIZE);

  for (const one of expired) {
    // Objects first, then the row. A row marked expired whose objects remain is
    // a copy of somebody's history that nothing will ever come back for.
    await removeObjects(options, one.storagePrefix);

    await withTransaction(options.dataSource, (tx) =>
      options.exports.markExpired(tx, one.requestId),
    );
  }

  return expired.length;
}

/**
 * Remove everything written under one export's prefix.
 *
 * @param options - Storage.
 * @param prefix - The export's prefix.
 * @returns Nothing.
 */
async function removeObjects(options: ExportBuildOptions, prefix: string): Promise<void> {
  // Listed rather than reconstructed from the part count, for the reason
  // upload deletion gives: removing a computed set of names leaves behind
  // anything written by a version of the code that named things differently.
  for (const key of await options.storage.list(prefix)) {
    await options.storage.remove(key);
  }
}
