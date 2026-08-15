import fp from "fastify-plugin";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

/**
 * Route schema validation and serialization, driven by the shared contracts.
 *
 * Routes declare Zod schemas from `@chronologity/contracts`, so the boundary
 * validates against the same definitions clients compile against. This is
 * transport validation only; application and domain validation remain separate
 * layers and are not collapsed into route schemas.
 */
export const validationPlugin = fp(async (app) => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
});
