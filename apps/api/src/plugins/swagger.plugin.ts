import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
} from "fastify-type-provider-zod";
import { contractRegistry } from "@chronologity/contracts";

/**
 * The OpenAPI document, and the page that browses it.
 *
 * Generated from the Zod schemas the routes already declare rather than written
 * alongside them, so it cannot describe behaviour the API does not have: the
 * same schema validates the request, serialises the response, and appears here.
 *
 * **Absent in production, rather than protected there.** A document describing
 * every authentication surface is a map of the attack surface, and ADR-081 goes
 * to some trouble to avoid disclosing whether an account exists. The routes are
 * not registered at all, so there is no endpoint to guard, mis-guard, or
 * forget.
 */
export interface SwaggerOptions {
  /** Whether to register at all. False in production. */
  readonly enabled: boolean;
}

export const swaggerPlugin = fp(async (app, options: SwaggerOptions) => {
  if (!options.enabled) {
    return;
  }

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Chronologity API",
        version: "0.1.0",
        description: [
          "Chronologity preserves and navigates personal and shared history as chronological Moments.",
          "",
          "Two things shape almost every endpoint here, and a client that does not know them will be wrong:",
          "",
          "**A 404 is not proof of absence.** Something you may not see and something that does not exist answer identically, deliberately. The same is true of authentication: no endpoint discloses whether an address, handle, or number belongs to an account.",
          "",
          "**Chronology comes from when something happened, never from when it was recorded.** A Moment entered today for 2014 belongs in 2014, and occurrence is an interval at the precision it is actually known at rather than a fabricated instant.",
        ].join("\n"),
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: [
              "The access token returned by any of the three sign-in routes.",
              "",
              "Sent as `Authorization: Bearer <token>`. A token that verifies is not sufficient on its own: the Session it names must still be open, so signing out takes effect immediately rather than when the token expires.",
            ].join("\n"),
          },
        },
      },
      // Required by default, and opted out of by the thirteen routes that
      // genuinely need no credential — the sign-in routes, the two health
      // probes, and one public profile read. Stated this way round because the
      // document previously said nothing at all about authentication, and a
      // reader had no way to tell which of a hundred and sixty-three operations
      // needed a token.
      security: [{ bearerAuth: [] }],
      tags: [
        { name: "Health", description: "Liveness and readiness." },
        { name: "Authentication", description: "Proving who somebody is. Three methods reach one Identity: a link sent to an address, a password, and a code sent to a phone number." },
        { name: "Users", description: "The account somebody chooses to present: handle, display name, preferences." },
        { name: "Authorization", description: "Platform roles and what they permit. Roles never live in tokens." },
        { name: "Uploads", description: "Media, uploaded straight to storage rather than through the API. What a file is comes from reading it, never from what the uploader said." },
        { name: "Locations", description: "Places, as shared reference data. A place keeps the name it had when a Moment was recorded." },
        { name: "Real-world Events", description: "Shared occurrences a Moment may have been part of." },
        { name: "Moments", description: "Something that happened, at a time, recorded by one person. Media is evidence of the experience; the Moment is the experience." },
        { name: "Social", description: "Following, requests, and blocking. Following says what somebody wants to hear about, never what they may see." },
      ],
    },
    // **Named shapes rather than inlined ones.** Without the registry every
    // schema is written out in full at every use site: two and a half megabytes,
    // a Moment described thirty-six separate times, and `components.schemas`
    // empty. That defeats the reason ADR-112 gives for committing this document
    // — "a diff on a pull request says the boundary moved" — because a change to
    // one field produced thirty-six identical hunks.
    transform: createJsonSchemaTransform({ schemaRegistry: contractRegistry }),
    transformObject: createJsonSchemaTransformObject({ schemaRegistry: contractRegistry }),
  });

  await app.register(swaggerUi, { routePrefix: "/docs" });
});
