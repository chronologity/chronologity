import helmet from "@fastify/helmet";
import fp from "fastify-plugin";

/**
 * Baseline security response headers.
 *
 * @param graphiql - Whether the in-browser explorer is being served. It is the
 *   one document this application returns, and it loads its own scripts and
 *   styles, so a content security policy has to allow them where it exists and
 *   should not be relaxed anywhere else.
 * @returns A Fastify plugin registering the headers.
 */
export const helmetPlugin = fp(async (app, options: { graphiql: boolean }) => {
  await app.register(helmet, {
    // Off outside development for the reason the API turns it off: this service
    // returns JSON to non-browser clients, and a content security policy
    // protects documents it does not serve. On where GraphiQL is served,
    // because then there is a document.
    contentSecurityPolicy: options.graphiql
      ? {
          directives: {
            "default-src": ["'self'"],
            // GraphiQL is delivered as an inline bootstrap alongside styles it
            // writes itself.
            "script-src": ["'self'", "'unsafe-inline'"],
            "style-src": ["'self'", "'unsafe-inline'"],
            "img-src": ["'self'", "data:"],
          },
        }
      : false,
  });
});
