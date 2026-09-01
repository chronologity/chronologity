import cors from "@fastify/cors";
import fp from "fastify-plugin";

/**
 * Cross-origin policy.
 *
 * No origins are permitted yet. The mobile client is not a browser and needs
 * none; the web application is a marketing site that reads no Timeline. An
 * empty allowlist is the honest starting point, and is safer than a permissive
 * default nobody revisits — the more so in front of a GraphQL endpoint, where
 * one permitted origin is permission to run any query the schema allows.
 */
export const corsPlugin = fp(async (app) => {
  await app.register(cors, { origin: false });
});
