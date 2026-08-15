import helmet from "@fastify/helmet";
import fp from "fastify-plugin";

/** Baseline security response headers. */
export const helmetPlugin = fp(async (app) => {
  await app.register(helmet, {
    // The API serves JSON to non-browser clients; a content security policy
    // protects documents it does not serve.
    contentSecurityPolicy: false,
  });
});
