/**
 * Shared configuration primitives.
 *
 * Application-specific configuration stays inside the application that owns
 * it. This package provides the parsing, validation, and failure semantics
 * those applications share.
 */
export {
  allowsDevelopmentDefaults,
  booleanSchema,
  ConfigurationError,
  listSchema,
  logLevelSchema,
  nodeEnvSchema,
  parseEnv,
  portSchema,
  urlSchema,
  type LogLevel,
  type NodeEnv,
} from "./env.js";
