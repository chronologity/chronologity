/**
 * The authentication feature's public surface.
 *
 * Everything else in this feature is internal. The plugin that authenticates
 * requests needs session validation, and the server needs the routes; nothing
 * outside should reach into commands, aggregates, or stores directly.
 */
export { authRoutes } from "./routes/auth.routes.js";
export { handleValidateSession } from "./queries/validate-session.handler.js";
export type { AuthDependencies } from "./dependencies.js";
export type { AuthRateLimits } from "./rate-limit-policy.js";
