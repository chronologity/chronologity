import fp from "fastify-plugin";
import { authenticateRequest } from "../auth/authenticate-request.js";
import type { Viewer } from "../auth/auth-context.js";
import type { SessionLookup } from "../auth/session.repository.js";
import type { AuthConfig } from "../config/auth-config.js";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Who is asking.
     *
     * Present on the routes this plugin covers, and only populated once the
     * hook below has run. Readers treat its absence as anonymous, which is the
     * safe direction: the only path that reaches a reader without the hook
     * having run is one that already failed.
     */
    viewer?: Viewer;
  }
}

/**
 * Establish the Viewer before any resolver runs.
 *
 * Registered inside the GraphQL scope, and it must stay there: health checks
 * have no Viewer, and running token verification on `/health/ready` would mean
 * a client with a stale credential could make an instance look unready.
 *
 * Wrapped in `fastify-plugin` so that it attaches its hook to the scope it is
 * registered on rather than to a context of its own. Without that the hook
 * would cover only its own empty context — the routes are siblings, not
 * children — and every request would arrive anonymous, which is the quietest
 * possible way for authentication to stop working.
 *
 * A hook rather than part of the GraphQL context function, for a reason worth
 * writing down. Mercurius rebuilds the request context inside its own error
 * handler when a request failed before one existed — so a context function that
 * threw would be called a second time while the first throw was being handled,
 * and throw again from inside the error path. Resolving here means the refusal
 * happens where Fastify expects one, and the context function only ever reads a
 * value that is already there.
 *
 * @param app - The scope to register on. Must be the one containing the GraphQL
 *   routes and nothing else.
 * @param options - How to verify a token, and where to ask whether the Session
 *   it names is still open.
 * @returns Nothing.
 */
export const authPlugin = fp(async function authPlugin(
  app,
  options: { config: AuthConfig; sessions: SessionLookup },
) {
  // Declared for shape, so every request object in this scope looks the same to
  // the runtime, and populated by the hook below. Declared without a value,
  // because Fastify refuses a reference-type decorator — one object would then
  // be shared by every request, which for a Viewer is the sharing this whole
  // file exists to prevent. Readers treat its absence as anonymous.
  app.decorateRequest("viewer");

  app.addHook("preHandler", async (request) => {
    request.viewer = await authenticateRequest(
      request.headers.authorization,
      options.config,
      options.sessions,
      new Date(),
    );
  });
});
