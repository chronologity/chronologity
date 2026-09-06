import {
  discoveryRequestSchema,
  nearbyDiscoveryRequestSchema,
  recommendationPageSchema,
} from "@chronologity/contracts";
import { defineOperation } from "./operation.js";

/**
 * History somebody did not ask for.
 *
 * **Discovery is not Search**, and the difference is intent: Search begins with
 * somebody typing, Discovery begins without them. It is an amplification
 * surface, so its rules are *stricter* than direct access — a Moment you may
 * open is not necessarily one that may be recommended to you.
 *
 * **Every recommendation says why it was offered**, and the reason names a
 * property of the recommendation itself rather than anything about you. No
 * score is ever returned.
 */

/** History worth seeing, chosen without a query. */
export const explore = defineOperation({
  method: "GET",
  template: "/discovery/explore",
  query: discoveryRequestSchema,
  response: recommendationPageSchema,
});

/** History from one occasion. */
export const discoverByEvent = defineOperation({
  method: "GET",
  template: "/discovery/events/:realWorldEventId",
  path: (args: { params: { realWorldEventId: string } }) =>
    `/discovery/events/${args.params.realWorldEventId}`,
  query: discoveryRequestSchema,
  response: recommendationPageSchema,
});

/** History at one place. */
export const discoverByLocation = defineOperation({
  method: "GET",
  template: "/discovery/locations/:locationId",
  path: (args: { params: { locationId: string } }) =>
    `/discovery/locations/${args.params.locationId}`,
  query: discoveryRequestSchema,
  response: recommendationPageSchema,
});

/** History near a position. */
export const discoverNearby = defineOperation({
  method: "GET",
  template: "/discovery/nearby",
  query: nearbyDiscoveryRequestSchema,
  response: recommendationPageSchema,
});

/** History related to one Moment. */
export const discoverRelated = defineOperation({
  method: "GET",
  template: "/moments/:momentId/related",
  path: (args: { params: { momentId: string } }) => `/moments/${args.params.momentId}/related`,
  query: discoveryRequestSchema,
  response: recommendationPageSchema,
});
