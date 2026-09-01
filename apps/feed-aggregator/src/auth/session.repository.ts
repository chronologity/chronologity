import type pg from "pg";

/** What a Session read comes to: who it belongs to, or nothing. */
export interface OpenSession {
  readonly identityId: string;
}

/**
 * The one question authentication asks of PostgreSQL.
 *
 * Declared as an interface so that the code deciding who a Viewer is depends on
 * the question rather than on the connection pool behind it. That keeps the
 * decision — which combinations authenticate and which refuse — testable
 * without a database, while the query itself is proven against a real one.
 */
export interface SessionLookup {
  /**
   * Read a Session, if it is still open.
   *
   * @param sessionId - The Session the token names.
   * @param now - The instant to judge expiry against.
   * @returns The Identity the Session belongs to, or undefined.
   */
  findOpen(sessionId: string, now: Date): Promise<OpenSession | undefined>;
}

/**
 * Whether a Session still authenticates a request.
 *
 * The single question this application asks PostgreSQL. It exists because
 * revocation is immediate and a token is not: somebody signs out on one device
 * and their access token remains cryptographically valid for the rest of its
 * ten minutes. A read service that honoured it would keep showing that person's
 * history to whoever holds the token, which is exactly the window somebody
 * signs out to close.
 *
 * The API asks the same question through `SessionService.validate`, and the
 * answer must be the same one. `authentication.policy.ts:36` defines usable as
 * not revoked and not expired, and that definition is reproduced in the `WHERE`
 * clause below rather than imported, because the two applications may not import
 * each other. If that policy changes, this changes with it — the integration
 * test that revokes a Session and expects a refusal is what would notice.
 */
export class SessionRepository implements SessionLookup {
  /**
   * Build the repository.
   *
   * @param pool - A read-only connection pool. Nothing here writes.
   */
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Read a Session, if it is still open.
   *
   * @param sessionId - The Session the token names. Must already be a UUID:
   *   `session_id` is a `uuid` column, and PostgreSQL raises rather than
   *   returning nothing when compared against something that is not one. The
   *   caller checks the shape, so that a malformed claim is a refusal rather
   *   than an internal error.
   * @param now - The instant to judge expiry against. Injected so a test can
   *   place a Session either side of its expiry without waiting.
   * @returns The Identity the Session belongs to, or undefined when there is no
   *   such Session, it was revoked, or it has expired. The three are one answer
   *   deliberately: the caller refuses all of them identically, and telling them
   *   apart would tell somebody probing which one to work on.
   */
  async findOpen(sessionId: string, now: Date): Promise<OpenSession | undefined> {
    const result = await this.pool.query<{ identity_id: string }>(
      `SELECT identity_id
         FROM sessions
        WHERE session_id = $1
          AND revoked_at IS NULL
          AND expires_at > $2`,
      [sessionId, now],
    );

    const row = result.rows[0];

    return row === undefined ? undefined : { identityId: row.identity_id };
  }
}
