import type { Permission, Role } from "@chronologity/contracts";
import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticationWiring } from "../features/authentication/authentication.types.js";
import { hasPermission } from "../features/authorization/authorization.policy.js";
import { AuthorizationRepository } from "../features/authorization/authorization.repository.js";
import { OnboardingRequiredError } from "../lib/errors/onboarding-required-error.js";
import { UnauthenticatedError, UnauthorizedError } from "../lib/errors/unauthorized-error.js";
import { verifyAccessToken } from "../lib/auth/tokens.js";
import { UserRepository } from "../features/users/user.repository.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Present only on routes that ran `requireSession`. */
    session: AuthenticatedSession;
    /** Present only on routes that ran `requireUser`. */
    user: AuthenticatedUser;
  }
}

export interface AuthenticatedSession {
  readonly identityId: string;
  readonly sessionId: string;
  /** Absent until account creation is complete. */
  readonly userId: string | undefined;
}

export interface AuthenticatedUser {
  readonly userId: string;
}

/**
 * Establish who is making a request.
 *
 * Two checks, both required. The token must verify — signature, issuer,
 * audience, expiry — and the Session it names must still be usable. The second
 * is what makes revocation immediate: a signed, unexpired token whose Session
 * was revoked a moment ago authenticates nothing.
 *
 * Every failure is the same 401. The caller learns that they are not
 * authenticated, and nothing about which of the checks refused them.
 */
export const authPlugin = fp(async function authPlugin(
  app,
  options: { deps: AuthenticationWiring },
) {
  const accounts = new UserRepository(options.deps.pool);

  app.decorate("resolveUserId", (identityId: string) => accounts.findIdForIdentity(identityId));

  // Built once rather than per request: it holds only the pool, and the roles
  // lookup is on the path of every privileged request.
  const roles = new AuthorizationRepository(options.deps.pool);

  app.decorate("readRoles", (userId: string) => roles.rolesFor(userId));

  // Declared here so every request object has the same shape, which keeps
  // Fastify's request allocation monomorphic. The value is only meaningful
  // once `authenticate` has run, and routes reach it through requireSession.
  app.decorateRequest("session", null as unknown as AuthenticatedSession);
  app.decorateRequest("user", null as unknown as AuthenticatedUser);

  app.decorate("authenticate", async function authenticate(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;

    if (header === undefined || !header.startsWith("Bearer ")) {
      throw new UnauthenticatedError("Authentication required");
    }

    const token = header.slice("Bearer ".length).trim();

    let claims;
    try {
      claims = await verifyAccessToken(options.deps.config, token);
    } catch {
      // Deliberately swallowed: the reason a token failed is not the
      // caller's business, and logging it here would log the token.
      throw new UnauthenticatedError("Authentication required");
    }

    const session = await options.deps.sessions.validate(claims.sessionId);

    if (session === undefined || session.identityId !== claims.identityId) {
      throw new UnauthenticatedError("Authentication required");
    }

    request.session = {
      identityId: claims.identityId,
      sessionId: claims.sessionId,
      userId: claims.userId,
    };
  });
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate(request: FastifyRequest): Promise<void>;
    /** Resolves an Identity to its User, for tokens issued before onboarding. */
    resolveUserId(identityId: string): Promise<string | undefined>;
    /** Reads current elevated roles. Never cached across requests. */
    readRoles(userId: string): Promise<readonly Role[]>;
  }
}

/**
 * Route guard. Attach as `preHandler` to require an authenticated Session.
 *
 * @param request - The request to authenticate. On success its session is
 *   populated.
 * @param _reply - Unused; Fastify passes it to every hook.
 * @returns Nothing.
 * @throws {UnauthenticatedError} If the token is absent, invalid, or names a
 *   Session that can no longer authenticate a request.
 */
export async function requireSession(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  await request.server.authenticate(request);
}

/**
 * Route guard requiring a completed account.
 *
 * Authenticating proves who someone is; it does not mean they have finished
 * creating an account. Routes needing a User say so here rather than
 * discovering the absence halfway through a handler.
 *
 * The identifier comes from the token when it is there. A token issued before
 * account creation does not carry one, so it is looked up instead — cheap, and
 * only for the window between finishing onboarding and the next refresh. The
 * alternative would be telling someone to sign in again immediately after
 * creating their account.
 *
 * @param request - The request. On success its user is populated.
 * @param reply - Passed through to the session guard.
 * @returns Nothing.
 * @throws {UnauthenticatedError} If the request is not authenticated at all.
 * @throws {OnboardingRequiredError} If it is authenticated but no account has
 *   been created, so the client knows to send them to onboarding rather than
 *   to sign in again.
 */
export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireSession(request, reply);

  const fromToken = request.session.userId;

  if (fromToken !== undefined) {
    request.user = { userId: fromToken };
    return;
  }

  const resolved = await request.server.resolveUserId(request.session.identityId);

  if (resolved === undefined) {
    throw new OnboardingRequiredError("Finish creating your account to continue");
  }

  request.user = { userId: resolved };
}

/**
 * Route guard requiring a permission.
 *
 * Roles are read from the authorization read model on every call rather than
 * taken from the token. A token claim is a cache of authorization state, not
 * the source of truth (`authorization.md:457`), and the simplest way to honour
 * that is not to cache it: removing someone's role stops their next request
 * rather than their next token refresh. The cost is one indexed lookup on a
 * request that already makes several.
 *
 * @param permission - What the route requires.
 * @returns A preHandler that authenticates, resolves the User, and refuses
 *   anyone whose roles do not confer the permission.
 */
export function requirePermission(permission: Permission) {
  return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await requireUser(request, reply);

    const roles = await request.server.readRoles(request.user.userId);

    if (!hasPermission(roles, permission)) {
      // Flat refusal, naming nothing. Which permission was missing is
      // already knowable from the capabilities endpoint, but existence
      // hiding for sensitive resources belongs to the features that own
      // them, and this guard should not decide it on their behalf.
      throw new UnauthorizedError("You do not have permission to do that");
    }
  };
}
