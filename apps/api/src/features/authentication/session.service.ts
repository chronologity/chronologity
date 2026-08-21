import { randomUUID } from "node:crypto";
import type { SessionCredentials, SessionSummary } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { recordAuthAudit } from "../../lib/auth/audit.js";
import { generateRefreshToken, hashToken, issueAccessToken } from "../../lib/auth/tokens.js";
import type { AuthConfig } from "../../config/auth-config.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { UnauthenticatedError } from "../../lib/errors/unauthorized-error.js";
import type { RequestContext } from "../../types/request-context.js";
import type { UserRepository } from "../users/user.repository.js";
import { classifyRefreshFailure, endsSession, isUsable } from "./authentication.policy.js";
import type { SessionRepository } from "./session.repository.js";

/**
 * Sessions: bounded authenticated login contexts.
 *
 * The Session, not the token, is the revocation boundary. An access token is a
 * short-lived representation of a Session; ending the Session ends every
 * credential derived from it, which is what makes "log out everywhere" mean
 * something.
 *
 * Only the SHA-256 hash of the current refresh credential is stored. The
 * credential itself is returned to the client once and never kept, so reading
 * the database does not confer the ability to refresh.
 *
 * This service does not decide whether a Session is deserved. It grants one to
 * an Identity that something else has already authenticated.
 */
export class SessionService {
  /**
   * Build the Session service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param sessions - Where Sessions are stored.
   * @param accounts - Resolves an Identity to its User, so an access token can
   *   carry it.
   * @param config - Token lifetimes and signing material.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionRepository,
    private readonly accounts: UserRepository,
    private readonly config: AuthConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Begin a Session for an already-authenticated Identity.
   *
   * Shared by every way of proving who you are. A magic link and a password are
   * different proofs of the same thing, and what follows the proof must be
   * identical — same semantics, same rotating credential, same revocation
   * boundary. Two implementations that agreed today would not stay that way.
   *
   * @param input - Whose Session, the kind of client, which proof was accepted,
   *   and the request context. The caller is responsible for having actually
   *   verified the Identity.
   * @returns The new Session's credentials. The refresh credential appears here
   *   once and is never retrievable again.
   */
  async issue(input: {
    identityId: string;
    clientKind: string | undefined;
    method: "magic_link" | "password";
    context: RequestContext;
  }): Promise<SessionCredentials> {
    const at = this.clock();
    const sessionId = randomUUID();
    const refresh = generateRefreshToken(this.config, at);

    // Resolved once, at issue time, rather than on every authenticated request.
    // Someone who completes account creation mid-session obtains a token
    // carrying it on their next refresh; until then the route guard falls back
    // to a lookup, so nothing is broken in the meantime.
    const userId = await this.accounts.findIdForIdentity(input.identityId);

    const access = await issueAccessToken(
      this.config,
      { identityId: input.identityId, sessionId, userId },
      at,
    );

    await withTransaction(this.dataSource, async (tx) => {
      await this.sessions.insert(tx, {
        sessionId,
        identityId: input.identityId,
        refreshTokenHash: refresh.tokenHash,
        createdAt: at,
        expiresAt: refresh.expiresAt,
        clientKind: input.clientKind,
      });

      await recordAuthAudit(tx, {
        eventType: "session_created",
        outcome: "success",
        identityId: input.identityId,
        sessionId,
        traceId: input.context.traceId,
        // Which proof was accepted is worth keeping: a password sign-in and a
        // link sign-in carry different risk, and telling them apart afterwards
        // requires having recorded it.
        context: { method: input.method },
      });
    });

    return {
      sessionId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
    };
  }

  /**
   * Rotate a Session's refresh credential.
   *
   * The rotation is one conditional update: the presented credential must
   * still be the current one, the Session must not have been revoked, and it
   * must not have expired. Matching nothing means one of those is false, and
   * the row is then read under a lock to say which — including the case where a
   * concurrent refresh rotated first, which a read-then-write would lose.
   *
   * A presented credential that is not the current one means an already-rotated
   * credential is in circulation, and the Session is ended rather than merely
   * refused: refusing a stolen credential while leaving the Session alive lets
   * whoever holds it keep trying.
   *
   * @param sessionId - Which Session.
   * @param refreshToken - The credential presented.
   * @param context - Trace identifier and receipt time.
   * @returns A fresh credential pair.
   * @throws {UnauthenticatedError} If the Session is unknown, revoked, expired,
   *   or the credential is not the current one. All four are one refusal, and
   *   the last also ends the Session.
   */
  async refresh(
    sessionId: string,
    refreshToken: string,
    context: RequestContext,
  ): Promise<SessionCredentials> {
    const at = this.clock();
    const presentedTokenHash = hashToken(refreshToken);
    const replacement = generateRefreshToken(this.config, at);

    const rotated = await withTransaction(this.dataSource, async (tx) => {
      const result = await this.sessions.rotate(tx, {
        sessionId,
        presentedTokenHash,
        newTokenHash: replacement.tokenHash,
        now: at,
      });

      if (result !== undefined) {
        await recordAuthAudit(tx, {
          eventType: "session_refreshed",
          outcome: "success",
          identityId: result.identityId,
          sessionId,
          traceId: context.traceId,
        });

        return result;
      }

      // Locked so the classification cannot be invalidated between reading the
      // row and acting on it.
      const session = await this.sessions.lockById(tx, sessionId);
      const rejection = classifyRefreshFailure(session, presentedTokenHash, at);

      if (rejection !== undefined && endsSession(rejection)) {
        await this.sessions.revoke(tx, sessionId, "refresh_token_reuse", at);
      }

      await recordAuthAudit(tx, {
        eventType: "session_refresh_rejected",
        outcome: "failure",
        identityId: session?.identityId,
        sessionId,
        // A row that reads as refreshable after the update matched nothing has
        // changed underneath this request. Refused, but deliberately not taken
        // as evidence of reuse: ending a Session on an ambiguous state would
        // log out whoever was unlucky rather than whoever was dishonest.
        reason: rejection ?? "session_state_changed",
        traceId: context.traceId,
      });

      return undefined;
    });

    if (rotated === undefined) {
      throw new UnauthenticatedError("Session could not be refreshed");
    }

    // Re-resolved on refresh, which is how a token catches up after account
    // creation.
    const userId = await this.accounts.findIdForIdentity(rotated.identityId);
    const access = await issueAccessToken(
      this.config,
      { identityId: rotated.identityId, sessionId, userId },
      at,
    );

    return {
      sessionId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: replacement.token,
      refreshTokenExpiresAt: replacement.expiresAt.toISOString(),
    };
  }

  /**
   * End one Session.
   *
   * @param sessionId - Which Session.
   * @param identityId - Who is asking.
   * @param reason - Why. Recorded, because a logout and a suspected theft end
   *   the same way but mean different things afterwards.
   * @param context - Trace identifier and receipt time.
   * @returns Nothing.
   * @throws {UnauthenticatedError} If the Session does not exist or belongs to
   *   someone else — reported identically, so this cannot be used to discover
   *   which session identifiers are real.
   */
  async revoke(
    sessionId: string,
    identityId: string,
    reason: string,
    context: RequestContext,
  ): Promise<void> {
    const at = this.clock();
    const session = await this.sessions.findById(sessionId);

    if (session === undefined || session.identityId !== identityId) {
      throw new UnauthenticatedError("Session could not be revoked");
    }

    await withTransaction(this.dataSource, async (tx) => {
      await this.sessions.revoke(tx, sessionId, reason, at);
      await recordAuthAudit(tx, {
        eventType: "session_revoked",
        outcome: "success",
        identityId,
        sessionId,
        reason,
        traceId: context.traceId,
      });
    });
  }

  /**
   * End every Session an Identity has open, optionally sparing one.
   *
   * @param input - Whose Sessions, why, which to keep, and the request context.
   * @returns How many were ended.
   */
  async revokeAll(input: {
    identityId: string;
    reason: string;
    exceptSessionId?: string | undefined;
    context: RequestContext;
  }): Promise<number> {
    const at = this.clock();
    const { identityId, reason, exceptSessionId, context } = input;

    return withTransaction(this.dataSource, async (tx) => {
      const revoked = await this.sessions.revokeAll(tx, {
        identityId,
        reason,
        at,
        ...(exceptSessionId === undefined ? {} : { exceptSessionId }),
      });

      // One record per Session as well as the summary: which Sessions ended is
      // the part an investigation needs, and a count alone cannot answer it.
      for (const sessionId of revoked) {
        await recordAuthAudit(tx, {
          eventType: "session_revoked",
          outcome: "success",
          identityId,
          sessionId,
          reason,
          traceId: context.traceId,
        });
      }

      await recordAuthAudit(tx, {
        eventType: "all_sessions_revoked",
        outcome: "success",
        identityId,
        reason,
        traceId: context.traceId,
        context: { revoked: revoked.length },
      });

      return revoked.length;
    });
  }

  /**
   * The Sessions an Identity currently has open.
   *
   * @param identityId - Whose Sessions.
   * @param currentSessionId - Which entry is the one asking.
   * @returns The open Sessions, newest first, with the caller's own marked.
   */
  async list(identityId: string, currentSessionId: string): Promise<SessionSummary[]> {
    return this.sessions.listOpen(identityId, currentSessionId);
  }

  /**
   * Decide whether a Session may authenticate a request right now.
   *
   * Runs on every authenticated request. Reading the row is what makes
   * revocation immediate: it is written synchronously in the request that
   * causes it, so a Session revoked a moment ago cannot still be found usable.
   *
   * @param sessionId - Which Session.
   * @returns The Identity it belongs to, or undefined if it cannot authenticate
   *   a request right now.
   */
  async validate(sessionId: string): Promise<{ identityId: string } | undefined> {
    const session = await this.sessions.findById(sessionId);

    if (session === undefined || !isUsable(session, this.clock())) {
      return undefined;
    }

    return { identityId: session.identityId };
  }
}
