import type { SessionSummary } from "@chronologity/contracts";
import type pg from "pg";
import type { Transaction } from "../../lib/database/transaction.js";
import type { NewSession, SessionRecord } from "./authentication.types.js";

/**
 * Where Sessions are stored.
 *
 * `sessions` is the authority for whether a Session may authenticate a request
 * (ADR-094). ADR-078 refused to trust this table because a lagging projection
 * could leave a revoked Session working; there is no projection — revocation is
 * written synchronously in the request that causes it — so reading the row is
 * fresher than replaying a stream ever was.
 *
 * Two writes here are conditional rather than read-then-write. Rotation
 * requires the presented credential to still be the current one, and revocation
 * keeps whichever reason arrived first. Both are the difference between a rule
 * and a hope.
 */

interface SessionRow {
  session_id: string;
  identity_id: string;
  refresh_token_hash: string | null;
  refresh_generation: number;
  expires_at: Date;
  revoked_at: Date | null;
}

const COLUMNS = `session_id, identity_id, refresh_token_hash,
                 refresh_generation, expires_at, revoked_at`;

/**
 * Shape a row into the stored Session a decision is made against.
 *
 * @param row - As read from `sessions`.
 * @returns The Session as the policy sees it.
 */
function toRecord(row: SessionRow): SessionRecord {
  return {
    sessionId: row.session_id,
    identityId: row.identity_id,
    refreshTokenHash: row.refresh_token_hash,
    refreshGeneration: row.refresh_generation,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

/** Reads and writes Sessions. */
export class SessionRepository {
  /**
   * Build the Session repository.
   *
   * @param pool - Used for reads. Writes take a transaction of their own.
   */
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Begin a Session.
   *
   * @param tx - The caller's transaction.
   * @param session - Everything established when it began.
   * @returns Nothing.
   */
  async insert(tx: Transaction, session: NewSession): Promise<void> {
    await tx.query(
      `INSERT INTO sessions
         (session_id, identity_id, created_at, expires_at, client_kind, refresh_token_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id) DO NOTHING`,
      [
        session.sessionId,
        session.identityId,
        session.createdAt.toISOString(),
        session.expiresAt.toISOString(),
        session.clientKind ?? null,
        session.refreshTokenHash,
      ],
    );
  }

  /**
   * Read one Session.
   *
   * @param sessionId - Which Session.
   * @returns Its stored state, or undefined if there is no such Session.
   */
  async findById(sessionId: string): Promise<SessionRecord | undefined> {
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT ${COLUMNS} FROM sessions WHERE session_id = $1`,
      [sessionId],
    );

    const row = rows[0];

    return row === undefined ? undefined : toRecord(row);
  }

  /**
   * Read one Session inside a transaction, holding it for that transaction.
   *
   * @param tx - The caller's transaction.
   * @param sessionId - Which Session.
   * @returns Its stored state, or undefined if there is no such Session. The
   *   row is locked, so a classification made from it cannot be invalidated by
   *   a concurrent write before the same transaction acts on it.
   */
  async lockById(tx: Transaction, sessionId: string): Promise<SessionRecord | undefined> {
    const { rows } = await tx.query<SessionRow>(
      `SELECT ${COLUMNS} FROM sessions WHERE session_id = $1 FOR UPDATE`,
      [sessionId],
    );

    const row = rows[0];

    return row === undefined ? undefined : toRecord(row);
  }

  /**
   * Rotate the refresh credential, if the presented one is still current.
   *
   * @param tx - The caller's transaction.
   * @param input - Which Session, the hash presented, its replacement, and the
   *   current instant.
   * @returns Whose Session it is and its new generation, or undefined when
   *   nothing matched. The condition carries the whole rule: the credential
   *   must be the current one, the Session must not have been revoked, and it
   *   must not have expired. Nothing matching means one of those is false —
   *   including the case where a concurrent refresh rotated first, which is
   *   exactly the race a read-then-write would lose.
   */
  async rotate(
    tx: Transaction,
    input: {
      sessionId: string;
      presentedTokenHash: string;
      newTokenHash: string;
      now: Date;
    },
  ): Promise<{ identityId: string; refreshGeneration: number } | undefined> {
    const { rows } = await tx.query<{ identity_id: string; refresh_generation: number }>(
      `UPDATE sessions
          SET refresh_token_hash = $3,
              refresh_generation = refresh_generation + 1,
              last_refreshed_at = $4
        WHERE session_id = $1
          AND refresh_token_hash = $2
          AND revoked_at IS NULL
          AND expires_at > $4
        RETURNING identity_id, refresh_generation`,
      [input.sessionId, input.presentedTokenHash, input.newTokenHash, input.now.toISOString()],
    );

    const row = rows[0];

    return row === undefined
      ? undefined
      : { identityId: row.identity_id, refreshGeneration: row.refresh_generation };
  }

  /**
   * End a Session.
   *
   * @param tx - The caller's transaction.
   * @param sessionId - Which Session.
   * @param reason - Why it ended.
   * @param at - When.
   * @returns Nothing. The first revocation wins: the reason a Session ended is
   *   the one that ended it, and a later logout must not overwrite evidence of
   *   a suspected theft.
   */
  async revoke(tx: Transaction, sessionId: string, reason: string, at: Date): Promise<void> {
    await tx.query(
      `UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, $2),
              revocation_reason = COALESCE(revocation_reason, $3)
        WHERE session_id = $1`,
      [sessionId, at.toISOString(), reason],
    );
  }

  /**
   * End every Session an Identity has open, optionally sparing one.
   *
   * @param tx - The caller's transaction.
   * @param input - Whose Sessions, why, when, and which to keep.
   * @returns The Sessions that were ended, so each can be recorded in the audit
   *   trail by name. Written as one statement rather than a list followed by a
   *   loop, so a Session opened while the loop ran cannot survive a "log out
   *   everywhere" that was meant to include it. Only unrevoked rows are
   *   touched, which is what keeps the first revocation's reason intact.
   */
  async revokeAll(
    tx: Transaction,
    input: { identityId: string; reason: string; at: Date; exceptSessionId?: string },
  ): Promise<string[]> {
    const { rows } = await tx.query<{ session_id: string }>(
      `UPDATE sessions
          SET revoked_at = $3, revocation_reason = $2
        WHERE identity_id = $1
          AND revoked_at IS NULL
          AND ($4::uuid IS NULL OR session_id <> $4)
        RETURNING session_id`,
      [input.identityId, input.reason, input.at.toISOString(), input.exceptSessionId ?? null],
    );

    return rows.map((row) => row.session_id);
  }

  /**
   * The Sessions an Identity currently has open.
   *
   * @param identityId - Whose Sessions.
   * @param currentSessionId - Which entry is the one asking, so a client can
   *   say "this device".
   * @returns The open Sessions, newest first. Revoked ones are omitted rather
   *   than shown as ended: someone reviewing their devices wants to know what
   *   is open now.
   */
  async listOpen(identityId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const { rows } = await this.pool.query<{
      session_id: string;
      created_at: Date;
      expires_at: Date;
      last_refreshed_at: Date | null;
    }>(
      `SELECT session_id, created_at, expires_at, last_refreshed_at
         FROM sessions
        WHERE identity_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC`,
      [identityId],
    );

    return rows.map((row) => ({
      sessionId: row.session_id,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      lastRefreshedAt: row.last_refreshed_at?.toISOString() ?? null,
      current: row.session_id === currentSessionId,
    }));
  }
}
