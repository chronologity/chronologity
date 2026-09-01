import type { FastifyInstance } from "fastify";
import { corsPlugin } from "../plugins/cors.plugin.js";
import { helmetPlugin } from "../plugins/helmet.plugin.js";
import { requestContextPlugin } from "../plugins/request-context.plugin.js";

/**
 * Register cross-cutting concerns, in the order they depend on each other.
 *
 * Request context is first so that everything after it — every log line, every
 * error envelope, every GraphQL error's `traceId` — can quote the identifier.
 *
 * Authentication is deliberately absent from this list. It belongs to the
 * GraphQL scope rather than to the application, because health checks have no
 * Viewer; `register-graphql.ts` mounts it there.
 *
 * There is no rate limiting yet. `feed.md` puts it under abuse protection
 * alongside complexity budgets and identifier probing, which is one piece of
 * work against a surface that does not exist yet — a limit tuned against a
 * schema with one field would be a number nobody could defend.
 *
 * @param app - The application to register on.
 * @param options - Whether the in-browser explorer is being served, which
 *   decides whether a content security policy is needed.
 * @returns Nothing.
 */
export async function registerPlugins(
  app: FastifyInstance,
  options: { graphiql: boolean },
): Promise<void> {
  await app.register(requestContextPlugin);
  await app.register(helmetPlugin, { graphiql: options.graphiql });
  await app.register(corsPlugin);
}
