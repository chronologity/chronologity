import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { ExportRequest } from "./export.model.js";
import type { ExportFailureState } from "./export.policy.js";

/** An export request claimed for building. */
export interface ClaimedExport {
  readonly requestId: string;
  readonly userId: string;
  /** How many attempts have been made, this claim included. */
  readonly attempts: number;
}

/**
 * The record of exports being prepared.
 *
 * Reads take the DataSource and writes take a transaction, following the
 * repositories beside it. The claim-lease-retry shape is the erasure
 * repository's, which is the outbox publisher's — the fourth instance of it in
 * this codebase, and recorded as such rather than quietly repeated again.
 */
export class ExportRepository {
  /**
   * Build the export repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Ask for an export to be prepared.
   *
   * @param tx - The caller's transaction.
   * @param entry - Who asked and when.
   * @returns Whether one was opened. False means a preparation is already under
   *   way for this account, which is the ordinary consequence of asking twice —
   *   and preparing twice would have the two builds sweep each other's objects.
   */
  async request(
    tx: Transaction,
    entry: { requestId: string; userId: string; at: Date },
  ): Promise<boolean> {
    const opened: { request_id: string }[] = await tx.query(
      `INSERT INTO export_requests (request_id, user_id, state, attempts, due_at, requested_at)
       VALUES ($1, $2, 'pending', 0, $3, $3)
       ON CONFLICT (user_id) WHERE state = 'pending' DO NOTHING
       RETURNING request_id`,
      [entry.requestId, entry.userId, entry.at],
    );

    return opened.length > 0;
  }

  /**
   * Take a batch of requests that have come due, and lease them.
   *
   * @param tx - The caller's transaction, which should commit immediately.
   * @param now - The instant to consider due.
   * @param limit - How many at most.
   * @param leaseMs - How long to hold each before another worker may take it.
   * @returns The claimed requests, oldest due first.
   */
  async claimDue(
    tx: Transaction,
    now: Date,
    limit: number,
    leaseMs: number,
  ): Promise<ClaimedExport[]> {
    const rows: { request_id: string; user_id: string; attempts: number }[] = await tx.query(
      `WITH due AS (
          SELECT request_id FROM export_requests
           WHERE state = 'pending' AND due_at <= $1
           ORDER BY due_at ASC, request_id ASC
           LIMIT $2
             FOR UPDATE SKIP LOCKED
       ), leased AS (
          UPDATE export_requests
             SET attempts = attempts + 1,
                 due_at   = $1::timestamptz + make_interval(secs => $3::double precision)
           WHERE request_id IN (SELECT request_id FROM due)
       RETURNING request_id, user_id, attempts
       ) SELECT * FROM leased`,
      [now, limit, leaseMs / 1_000],
    );

    return rows.map((row) => ({
      requestId: row.request_id,
      userId: row.user_id,
      attempts: row.attempts,
    }));
  }

  /**
   * Record that an export is ready.
   *
   * @param tx - The caller's transaction.
   * @param requestId - Which one.
   * @param result - Where the parts are, how many, when it was finished, and
   *   when it stops being available.
   * @returns Nothing.
   */
  async markReady(
    tx: Transaction,
    requestId: string,
    result: { storagePrefix: string; partCount: number; at: Date; expiresAt: Date },
  ): Promise<void> {
    await tx.query(
      `UPDATE export_requests
          SET state = 'ready', storage_prefix = $2, part_count = $3,
              completed_at = $4, expires_at = $5,
              error_category = NULL, last_error = NULL
        WHERE request_id = $1 AND state = 'pending'`,
      [requestId, result.storagePrefix, result.partCount, result.at, result.expiresAt],
    );
  }

  /**
   * Record that an attempt failed.
   *
   * @param tx - The caller's transaction.
   * @param requestId - Which one.
   * @param failure - The state to move to, why, and when to try again.
   * @returns Nothing.
   */
  async recordFailure(
    tx: Transaction,
    requestId: string,
    failure: {
      state: ExportFailureState;
      category: "transient" | "permanent";
      error: string;
      at: Date;
      retryAt: Date;
    },
  ): Promise<void> {
    const finished = failure.state !== "pending";

    await tx.query(
      `UPDATE export_requests
          SET state = $2, error_category = $3, last_error = $4, due_at = $5, completed_at = $6
        WHERE request_id = $1 AND state = 'pending'`,
      [
        requestId,
        failure.state,
        failure.category,
        failure.error.slice(0, 500),
        failure.retryAt,
        finished ? failure.at : null,
      ],
    );
  }

  /**
   * Exports whose life has run out.
   *
   * @param now - The instant to judge against.
   * @param limit - How many at most.
   * @returns Those still marked ready whose expiry has passed, with where their
   *   parts are so a sweep can remove them.
   */
  async expiredExports(
    now: Date,
    limit: number,
  ): Promise<{ requestId: string; storagePrefix: string }[]> {
    const rows: { request_id: string; storage_prefix: string }[] =
      await this.dataSource.query(
        `SELECT request_id, storage_prefix FROM export_requests
          WHERE state = 'ready' AND expires_at <= $1 AND storage_prefix IS NOT NULL
          ORDER BY expires_at ASC
          LIMIT $2`,
        [now, limit],
      );

    return rows.map((row) => ({
      requestId: row.request_id,
      storagePrefix: row.storage_prefix,
    }));
  }

  /**
   * Record that an export is no longer available.
   *
   * @param tx - The caller's transaction.
   * @param requestId - Which one.
   * @returns Nothing. The prefix is kept: it is where the objects were, which
   *   an operator checking that a sweep actually ran will want, and it names no
   *   history by itself.
   */
  async markExpired(tx: Transaction, requestId: string): Promise<void> {
    await tx.query(
      `UPDATE export_requests SET state = 'expired' WHERE request_id = $1 AND state = 'ready'`,
      [requestId],
    );
  }

  /**
   * The most recent export for an account.
   *
   * @param userId - Whose.
   * @returns It, or undefined when they have never asked for one. Most recent
   *   rather than the one being prepared, so somebody whose export has expired
   *   is told that rather than told nothing.
   */
  async findLatest(userId: string): Promise<ExportRequest | undefined> {
    const row = await this.dataSource.getRepository(ExportRequest).findOne({
      where: { userId },
      order: { requestedAt: "DESC" },
    });

    return row ?? undefined;
  }

  /**
   * Every prepared export for an account other than one.
   *
   * @param userId - Whose.
   * @param exceptRequestId - The one to leave alone.
   * @returns The others that still have objects, so preparing a new export can
   *   remove what the last one left behind rather than accumulating copies.
   */
  async supersededExports(
    userId: string,
    exceptRequestId: string,
  ): Promise<{ requestId: string; storagePrefix: string }[]> {
    const rows: { request_id: string; storage_prefix: string }[] =
      await this.dataSource.query(
        `SELECT request_id, storage_prefix FROM export_requests
          WHERE user_id = $1 AND request_id <> $2
            AND state = 'ready' AND storage_prefix IS NOT NULL`,
        [userId, exceptRequestId],
      );

    return rows.map((row) => ({
      requestId: row.request_id,
      storagePrefix: row.storage_prefix,
    }));
  }
}
