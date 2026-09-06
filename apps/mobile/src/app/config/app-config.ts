import { readEnv } from "./env";

/**
 * The configuration this application runs on.
 *
 * Assembled once at launch and passed explicitly from there, exactly as
 * `apps/feed-aggregator` does it. Nothing reads the environment after this
 * point, so there is one place where a value can be wrong and one place to look
 * when it is.
 */
export interface AppConfig {
  /** Where the authoritative REST API is. */
  readonly apiUrl: string;
  /** Where the read-only Timeline aggregator is. */
  readonly feedUrl: string;
}

/**
 * Assemble the configuration.
 *
 * @param source - The environment to read, injectable for tests.
 * @returns The configuration.
 * @throws {ConfigurationError} If the environment is incomplete, which stops
 *   the application at launch rather than at the first request.
 */
export function loadConfig(source?: Record<string, string | undefined>): AppConfig {
  const env = readEnv(source);

  return {
    apiUrl: env.EXPO_PUBLIC_API_URL,
    feedUrl: env.EXPO_PUBLIC_FEED_URL,
  };
}
