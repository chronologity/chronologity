import type { Env } from "./env.js";

/** Where places are looked up, and how politely. */
export interface PlacesConfig {
  readonly endpoint: string;
  readonly userAgent: string;
  readonly minimumIntervalMs: number;
}

/**
 * Derive place-search settings from the environment.
 *
 * @param env - The validated environment.
 * @returns Where to look places up and how fast we may ask.
 */
export function toPlacesConfig(env: Env): PlacesConfig {
  return {
    endpoint: env.PLACES_ENDPOINT,
    userAgent: env.PLACES_USER_AGENT,
    minimumIntervalMs: env.PLACES_MINIMUM_INTERVAL_MS,
  };
}
