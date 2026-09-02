import cors from "@fastify/cors";
import fp from "fastify-plugin";

/**
 * Cross-origin policy.
 *
 * No origins are permitted yet. The mobile client is not a browser and needs
 * none; the web application's requirements are established when it exists.
 * An empty allowlist is the honest starting point, and is safer than a
 * permissive default nobody revisits.
 */
export const corsPlugin = fp(async (app) => {
  await app.register(cors, { origin: false });
});
