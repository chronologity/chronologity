import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { ErasureRequest } from "./erasure.model.js";
import type { ErasureFailureState } from "./erasure.policy.js";

/** An erasure request claimed for work. */
export interface ClaimedErasure {
  readonly requestId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  /** How many attempts have been made, this claim included. */
  readonly attempts: number;
}

/**
 * The ledger of erasure still owed.
 *
 * Reads take the DataSource and writes take a transaction, following the
 * repositories beside it.
 *
 * Every statement here is written so that doing it twice is the same as doing
 * it once. Erasure is retried by design — `architecture/privacy.md:1149`
 * requires it to be — and a ledger that double-counted an attempt or reopened a
 * finished request would turn a retry into a second deletion.
 */
export class ErasureRepository {
  /**
   * Build the erasure repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction, so a request
   *   commits with the change that made it necessary.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Ask for something to be erased.
   *
   * @param tx - The caller's transaction, which must be the one marking the
   *   subject deleted. A subject cannot be marked deleted without the request
   *   to finish the job, and cannot acquire a request without being deleted.
   * @param entry - What to erase and when it was asked for.
   * @returns Whether a request was opened. False means one is already
   *   outstanding for this subject, which is the ordinary consequence of a
   *   double-click rather than a failure.
   */
  async request(
    tx: Transaction,
    entry: { requestId: string; subjectType: string; subjectId: string; at: Date },
  ): Promise<boolean> {
    const opened: { request_id: string }[] = await tx.query(
      `INSERT INTO erasure_requests
         (request_id, subject_type, subject_id, state, attempts, due_at, requested_at)
       VALUES ($1, $2, $3, 'pending', 0, $4, $4)
       ON CONFLICT (subject_type, subject_id) WHERE state = 'pending' DO NOTHING
       RETURNING request_id`,
      [entry.requestId, entry.subjectType, entry.subjectId, entry.at],
    );

    return opened.length > 0;
  }

  /**
   * Take a batch of requests that have come due, and lease them.
   *
   * `FOR UPDATE SKIP LOCKED`, following the outbox publisher: several workers
   * may run, and they take disjoint work rather than erasing the same thing
   * twice or queueing behind one slow object store.
   *
   * The lease is written and committed by the caller before any slow work
   * begins, so a process that dies mid-erasure leaves a request that becomes
   * due again rather than one stuck in a state nobody clears.
   *
   * @param tx - The caller's transaction, which should commit immediately.
   * @param now - The instant to consider due.
   * @param limit - How many at most.
   * @param leaseMs - How long to hold each before another worker may take it.
   * @returns The claimed requests, oldest due first, so a backlog drains in the
   *   order it accumulated.
   */
  async claimDue(
    tx: Transaction,
    now: Date,
    limit: number,
    leaseMs: number,
  ): Promise<ClaimedErasure[]> {
    const rows: {
      request_id: string;
      subject_type: string;
      subject_id: string;
      attempts: number;
    }[] = await tx.query(
      `WITH due AS (
          SELECT request_id
            FROM erasure_requests
           WHERE state = 'pending' AND due_at <= $1
           ORDER BY due_at ASC, request_id ASC
           LIMIT $2
             FOR UPDATE SKIP LOCKED
       ), leased AS (
          UPDATE erasure_requests
             SET attempts = attempts + 1,
                 due_at   = $1::timestamptz + make_interval(secs => $3::double precision)
           WHERE request_id IN (SELECT request_id FROM due)
       RETURNING request_id, subject_type, subject_id, attempts
       ) SELECT * FROM leased`,
      [now, limit, leaseMs / 1_000],
    );

    return rows.map((row) => ({
      requestId: row.request_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      attempts: row.attempts,
    }));
  }

  /**
   * Record that a request is finished.
   *
   * @param tx - The caller's transaction.
   * @param requestId - Which one.
   * @param at - When.
   * @returns Nothing. Completing one already finished changes nothing, which is
   *   what a retry after a lost acknowledgement needs.
   */
  async complete(tx: Transaction, requestId: string, at: Date): Promise<void> {
    await tx.query(
      `UPDATE erasure_requests
          SET state = 'completed', completed_at = $2, error_category = NULL, last_error = NULL
        WHERE request_id = $1 AND state = 'pending'`,
      [requestId, at],
    );
  }

  /**
   * Record that an attempt failed.
   *
   * @param tx - The caller's transaction.
   * @param requestId - Which one.
   * @param failure - The state to move to, why, and when to try again.
   * @returns Nothing. A request left pending keeps its retry time; one that is
   *   finished records when, because the database refuses a finished request
   *   without a completion time.
   */
  async recordFailure(
    tx: Transaction,
    requestId: string,
    failure: {
      state: ErasureFailureState;
      category: "transient" | "permanent";
      error: string;
      at: Date;
      retryAt: Date;
    },
  ): Promise<void> {
    const finished = failure.state !== "pending";

    await tx.query(
      `UPDATE erasure_requests
          SET state          = $2,
              error_category = $3,
              last_error     = $4,
              due_at         = $5,
              completed_at   = $6
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
   * One request, for reporting on it.
   *
   * @param subjectType - What kind of thing.
   * @param subjectId - Which one.
   * @returns The most recent request for it, or undefined when none was ever
   *   made. Most recent rather than the outstanding one, so a completed erasure
   *   remains answerable.
   */
  async findLatest(
    subjectType: string,
    subjectId: string,
  ): Promise<ErasureRequest | undefined> {
    const row = await this.dataSource.getRepository(ErasureRequest).findOne({
      where: { subjectType, subjectId },
      order: { requestedAt: "DESC" },
    });

    return row ?? undefined;
  }
}
