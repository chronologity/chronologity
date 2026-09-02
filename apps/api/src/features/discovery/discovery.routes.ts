import {
  discoveryRequestSchema,
  identifierSchema,
  nearbyDiscoveryRequestSchema,
  recommendationPageSchema,
} from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import type { DiscoveryService } from "./discovery.service.js";

/**
 * Discovery endpoints.
 *
 * Four surfaces, one eligibility rule. Everything here recommends history to
 * somebody who did not ask for it, which is a stricter test than either seeing
 * or finding:
 *
 * ```text
 * may view directly  !=  may be searched  !=  may be recommended
 * ```
 *
 * @param discovery - The service these routes delegate to.
 * @returns A Fastify plugin registering the Discovery endpoints.
 */
export function discoveryRoutes(discovery: DiscoveryService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Discovery"] };
    });

    const recommends = [
      "**Being able to see something is not permission to be shown it.** Everything here passes the access rule Search uses and is then narrowed further: it must be public, its author must have left it discoverable, moderation must permit amplification, and its author must be an adult. A restricted Moment is never recommended — not even to somebody on its list — and a private one is never recommended, including to its own author.",
      "",
      "**Nothing is ranked by popularity.** Reactions, comments, and views are not signals, and the ranking code cannot reach them. Explore orders by derived historical significance, used as context rather than as a universal score, and no score is returned.",
      "",
      "**No one voice fills a page.** How much any single author, place, or Event may occupy is capped, so a page may come back shorter than asked for. That is the cap working rather than a shortage.",
      "",
      "**Every result says why it was offered.** Each reason describes the recommendation itself, so an explanation can never disclose more than the recommendation already does.",
    ].join("\n");

    app.get(
      "/discovery/explore",
      {
        schema: {
          summary: "History worth exploring",
          description: [
            "Public history, offered to anybody. Not personalised and not assembled from anything you have looked at — which is also why a new account sees the same page as an old one.",
            "",
            recommends,
          ].join("\n"),
          querystring: discoveryRequestSchema,
          response: { 200: recommendationPageSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) => discovery.explore(request.query, request.user.userId),
    );

    app.get(
      "/discovery/events/:realWorldEventId",
      {
        schema: {
          summary: "History from an occurrence",
          description: [
            "What people recorded of a real-world Event. An Event with no history you may be offered returns an empty page rather than a refusal: that the Event exists is not a secret, and how much of its history reaches you is.",
            "",
            recommends,
          ].join("\n"),
          params: z.object({ realWorldEventId: identifierSchema }),
          querystring: discoveryRequestSchema,
          response: { 200: recommendationPageSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        discovery.fromEvent(
          request.params.realWorldEventId,
          request.query,
          request.user.userId,
        ),
    );

    app.get(
      "/discovery/locations/:locationId",
      {
        schema: {
          summary: "History at a place",
          description: [
            "What happened somewhere. Answered at the granularity each Moment's author disclosed, so a place somebody shared only at city level is reachable by a city-sized view and not a street-sized one.",
            "",
            recommends,
          ].join("\n"),
          params: z.object({ locationId: identifierSchema }),
          querystring: discoveryRequestSchema,
          response: { 200: recommendationPageSchema, ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        discovery.fromLocation(request.params.locationId, request.query, request.user.userId),
    );

    app.get(
      "/discovery/nearby",
      {
        schema: {
          summary: "History near a position",
          description: [
            "History around a point. **Your position is query input and nothing else** — it is never stored as history, never becomes visible presence, and using this does not turn on location sharing of any kind.",
            "",
            "As with Search, a radius is answered at the granularity the disclosures allow rather than being honoured exactly.",
            "",
            recommends,
          ].join("\n"),
          querystring: nearbyDiscoveryRequestSchema,
          response: { 200: recommendationPageSchema, ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        discovery.fromLocation(undefined, request.query, request.user.userId),
    );

    app.get(
      "/moments/:momentId/related",
      {
        schema: {
          summary: "History related to this",
          description: [
            "Other history connected to a Moment: relationships somebody asserted, the same real-world Event, or the same place.",
            "",
            "**Nothing here is inferred.** Every connection was claimed by a person, and no similarity a model noticed is presented as though it were an established relationship.",
            "",
            recommends,
          ].join("\n"),
          params: z.object({ momentId: identifierSchema }),
          querystring: discoveryRequestSchema,
          response: { 200: recommendationPageSchema, ...errors(400, 401, 404) },
        },
        preHandler: requireUser,
      },
      async (request) =>
        discovery.relatedTo(request.params.momentId, request.query, request.user.userId),
    );
  };
}
