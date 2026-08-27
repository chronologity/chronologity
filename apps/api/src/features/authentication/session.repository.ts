import type { SessionSummary } from "@chronologity/contracts";
import { IsNull, type DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { Session } from "./session.model.js";
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

/** The columns a stored Session is built from. Named once so the reads agree. */
const selection = {
  sessionId: true,
  identityId: true,
  refreshTokenHash: true,
  refreshGeneration: true,
  expiresAt: true,
  revokedAt: true,
} as const;

/**
 * Shape a row into the stored Session a decision is made against.
 *
 * @param row - As read from `sessions`.
 * @returns The Session as the policy sees it.
 */
function toRecord(row: Session): SessionRecord {
  return {
    sessionId: row.sessionId,
    identityId: row.identityId,
    refreshTokenHash: row.refreshTokenHash,
    refreshGeneration: row.refreshGeneration,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

/** Reads and writes Sessions. */
export class SessionRepository {
  /**
   * Build the Session repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction of their own.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Begin a Session.
   *
   * @param tx - The caller's transaction.
   * @param session - Everything established when it began.
   * @returns Nothing.
   */
  async insert(tx: Transaction, session: NewSession): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(Session)
      .values({
        sessionId: session.sessionId,
        identityId: session.identityId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        clientKind: session.clientKind ?? null,
        refreshTokenHash: session.refreshTokenHash,
        refreshGeneration: 0,
        revokedAt: null,
        revocationReason: null,
        lastRefreshedAt: null,
      })
      .orIgnore()
      .execute();
  }

  /**
   * Read one Session.
   *
   * @param sessionId - Which Session.
   * @returns Its stored state, or undefined if there is no such Session.
   */
  async findById(sessionId: string): Promise<SessionRecord | undefined> {
    const row = await this.dataSource
      .getRepository(Session)
      .findOne({ where: { sessionId }, select: selection });

    return row === null ? undefined : toRecord(row);
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
    // The lock is the entire point of this read, and it is taken through the
    // caller's transaction so the row is held by it and released when it ends.
    // TypeORM refuses a pessimistic lock outside a transaction rather than
    // quietly taking one that is released immediately.
    const row = await tx
      .createQueryBuilder(Session, "session")
      .setLock("pessimistic_write")
      .where("session.sessionId = :sessionId", { sessionId })
      .getOne();

    return row === null ? undefined : toRecord(row);
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
    // Every part of the rule is in the condition, so the statement either
    // matches and rotates or matches nothing at all. RETURNING is what makes
    // the new generation readable without a second read that a concurrent
    // refresh could get between.
    const rotated = await tx
      .createQueryBuilder()
      .update(Session)
      .set({
        refreshTokenHash: input.newTokenHash,
        refreshGeneration: () => "refresh_generation + 1",
        lastRefreshedAt: input.now,
      })
      .where("session_id = :sessionId", { sessionId: input.sessionId })
      .andWhere("refresh_token_hash = :presented", { presented: input.presentedTokenHash })
      .andWhere("revoked_at IS NULL")
      .andWhere("expires_at > :now", { now: input.now })
      .returning(["identityId", "refreshGeneration"])
      .execute();

    const row = (rotated.raw as { identity_id: string; refresh_generation: number }[])[0];

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
    // Already-revoked rows are excluded rather than written over with their own
    // values, which is what makes the first reason the one that stands.
    await tx.update(
      Session,
      { sessionId, revokedAt: IsNull() },
      { revokedAt: at, revocationReason: reason },
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
    const query = tx
      .createQueryBuilder()
      .update(Session)
      .set({ revokedAt: input.at, revocationReason: input.reason })
      .where("identity_id = :identityId", { identityId: input.identityId })
      .andWhere("revoked_at IS NULL");

    // Added rather than expressed as a condition that matches everything, so
    // "spare none" and "spare this one" are the same statement with one clause
    // more.
    if (input.exceptSessionId !== undefined) {
      query.andWhere("session_id <> :except", { except: input.exceptSessionId });
    }

    const revoked = await query.returning(["sessionId"]).execute();

    return (revoked.raw as { session_id: string }[]).map((row) => row.session_id);
  }

  /**
   * Remove every Session an Identity has, rather than revoking them.
   *
   * Revocation is the right answer everywhere else: a revoked Session is a
   * record that somebody was signed in and is not any more, which an
   * investigation may need. This is the one case where the rows must go — a
   * Session row carries a refresh-token hash, which is a credential, and an
   * account that has been deleted should leave none behind.
   *
   * @param tx - The caller's transaction.
   * @param identityId - Whose.
   * @returns How many were removed, so a caller can report it.
   */
  async eraseAllForIdentity(tx: Transaction, identityId: string): Promise<number> {
    const rows: { count: number }[] = await tx.query(
      `WITH erased AS (
          DELETE FROM sessions WHERE identity_id = $1 RETURNING 1
       ) SELECT COUNT(*)::int AS count FROM erased`,
      [identityId],
    );

    return rows[0]?.count ?? 0;
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
    const rows = await this.dataSource.getRepository(Session).find({
      where: { identityId, revokedAt: IsNull() },
      select: { sessionId: true, createdAt: true, expiresAt: true, lastRefreshedAt: true },
      order: { createdAt: "DESC" },
    });

    return rows.map((row) => ({
      sessionId: row.sessionId,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      lastRefreshedAt: row.lastRefreshedAt?.toISOString() ?? null,
      current: row.sessionId === currentSessionId,
    }));
  }
}
