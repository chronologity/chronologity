/**
 * The Locations feature's public surface.
 *
 * Everything else is internal. The server needs the routes; later phases need
 * to read a place when a Moment refers to one.
 */
export { locationRoutes } from "./routes/location.routes.js";
export { handleGetLocation } from "./queries/get-location.handler.js";
export type { LocationDependencies } from "./dependencies.js";
