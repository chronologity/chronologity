/**
 * The Users feature's public surface.
 *
 * Everything else is internal. The server needs the routes; the auth feature
 * needs to resolve an Identity to its User when issuing a token.
 */
export { userRoutes } from "./routes/user.routes.js";
export { findUserIdForIdentity } from "./utils/user-read-model.js";
export type { UserDependencies } from "./dependencies.js";
