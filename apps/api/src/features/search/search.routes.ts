import { searchPageSchema, searchRequestSchema } from "@chronologity/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireUser } from "../../plugins/auth.plugin.js";
import { errors } from "../../server/error-responses.js";
import type { SearchService } from "./search.service.js";

/**
 * The Search endpoint.
 *
 * One entry point rather than one per kind of thing. Results carry what they
 * are, so a client can group them without Chronologity flattening history into
 * an undifferentiated list of media posts, and a client wanting one kind sends
 * a type filter rather than calling a different path.
 *
 * @param search - The service this route delegates to.
 * @returns A Fastify plugin registering the Search endpoint.
 */
export function searchRoutes(search: SearchService) {
  return async function register(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.addHook("onRoute", (route) => {
      route.schema = { ...route.schema, tags: ["Search"] };
    });

    app.get(
      "/search",
      {
        schema: {
          summary: "Find history",
          description: [
            "Searches Moments, accounts, real-world Events, and Locations at once; `type` narrows it to one. Every result carries what it is.",
            "",
            "**A result is a pointer, not a permission.** Opening one reauthorizes against current state — a result you saw a minute ago may refuse to open, and that is the system working rather than failing.",
            "",
            "**Nothing is ranked by popularity.** Reactions and comments are not signals here. Historical significance breaks ties between comparably good matches and never promotes a weak one, and no score is returned: a number beside a result reads as a judgement about the past.",
            "",
            "**Occurrence precision is preserved.** A Moment known only as 'summer 1998' is found by a search for 1998 and does not acquire an invented date to make the comparison easier. Temporal filters overlap rather than contain.",
            "",
            "**Proximity is answered at the granularity the author allowed.** `geoPrecision` in the response says which — a 200 metre radius cannot be honoured for a Moment whose author shared only the city, and rather than rounding that away silently, the response says what it could actually do. A Moment with its place hidden is never a proximity match.",
            "",
            "**A cursor belongs to one search.** Sending one from a different query, or from before a ranking change, is refused rather than silently restarted or re-ordered mid-page.",
            "",
            "Zero results means zero results. Nothing loosely related is substituted to avoid an empty answer.",
          ].join("\n"),
          querystring: searchRequestSchema,
          response: { 200: searchPageSchema, ...errors(400, 401) },
        },
        preHandler: requireUser,
      },
      async (request) => search.search(request.query, request.user.userId),
    );
  };
}
