import { z } from "zod";

/**
 * Environment parsing primitives.
 *
 * Configuration is validated once, at startup, and the process fails fast when
 * a required value is missing or invalid. Discovering a missing variable only
 * after serving traffic is the failure mode this exists to prevent.
 *
 * This package holds no secrets and no application-specific configuration.
 * Applications declare their own schema and call `parseEnv` with it.
 */

/** A TCP port. Accepts the string form environments actually provide. */
export const portSchema = z.coerce.number().int().min(1).max(65_535);

/** A boolean from an environment variable, which is always a string. */
export const booleanSchema = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

/** An absolute URL. Rejects the empty string rather than treating it as unset. */
export const urlSchema = z.url();

/** Comma-separated list, trimmed, with empty entries dropped. */
export const listSchema = z.string().transform((value) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0),
);

export const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

export const logLevelSchema = z
  .enum(["trace", "debug", "info", "warn", "error", "fatal"])
  .default("info");

export type NodeEnv = z.infer<typeof nodeEnvSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;

/** Thrown when the environment does not satisfy the schema. */
export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.issues = issues;
  }
}

/**
 * Parse and validate an environment.
 *
 * Throws {@link ConfigurationError} listing every problem at once, rather than
 * failing on the first one: a developer fixing local configuration should see
 * the whole list, not discover it one restart at a time.
 *
 * Error messages name the offending variable but never echo its value, since
 * the values most likely to be malformed are also the ones most likely to be
 * secret.
 */
export function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  source: Record<string, string | undefined> = process.env,
): z.infer<Schema> {
  const result = schema.safeParse(source);

  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });

  throw new ConfigurationError(issues);
}

/**
 * Whether defaults intended for local development may be applied.
 *
 * Production must state its configuration explicitly. A convenience default
 * that silently survives into production is how a service ends up pointed at
 * the wrong database.
 */
export function allowsDevelopmentDefaults(nodeEnv: NodeEnv): boolean {
  return nodeEnv !== "production";
}
