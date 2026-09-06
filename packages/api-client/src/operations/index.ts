/**
 * Everything the API can do, as this package offers it.
 *
 * One module per feature, mirroring the API's own route modules. Grouped rather
 * than flat because a hundred and sixty-three names in one namespace is a list
 * nobody can find anything in, and because the grouping is the API's own — a
 * client operation and the route behind it should be findable from each other.
 *
 * Re-exported by namespace rather than by name: `moments.recordMoment` says what
 * it is at the call site, where a bare `recordMoment` alongside a hundred and
 * sixty-two siblings would not.
 */
export * as authentication from "./authentication.js";
export * as authorization from "./authorization.js";
export * as discovery from "./discovery.js";
export * as health from "./health.js";
export * as locations from "./locations.js";
export * as moderation from "./moderation.js";
export * as moments from "./moments.js";
export * as notifications from "./notifications.js";
export * as participation from "./participation.js";
export * as realWorldEvents from "./real-world-events.js";
export * as savedViews from "./saved-views.js";
export * as search from "./search.js";
export * as social from "./social.js";
export * as uploads from "./uploads.js";
export * as users from "./users.js";

export { defineOperation, type CallOptions, type Method, type Operation } from "./operation.js";
