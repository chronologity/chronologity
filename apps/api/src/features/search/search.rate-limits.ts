/**
 * How hard the Search surfaces may be pushed.
 *
 * Configurable rather than hardcoded for the reason the authentication limits
 * are: the right number depends on the deployment, and a test proving the limit
 * works has to reach it deliberately while every other test stays under it.
 *
 * Autocomplete is limited far harder than search, and not because it is
 * expensive. It is an enumeration surface by construction — somebody walking
 * the alphabet through it is asking the system to list what exists — and the
 * eligibility rule bounds *what* each answer contains rather than how many
 * answers somebody may collect.
 */
export interface SearchRateLimits {
  /** Finished questions. Generous: a person searches a few times a minute. */
  readonly searchesPerWindow: number;
  /**
   * Prefixes. Higher than search in absolute terms, because a suggestion box
   * fires while somebody types, and still a ceiling — a client typing one
   * character at a time makes a handful of calls, not hundreds.
   */
  readonly suggestionsPerWindow: number;
  readonly windowMinutes: number;
}

export const defaultSearchRateLimits: SearchRateLimits = {
  searchesPerWindow: 60,
  suggestionsPerWindow: 120,
  windowMinutes: 1,
};
