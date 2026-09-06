import {
  searchPageSchema,
  searchRequestSchema,
  searchSuggestionsSchema,
  searchSuggestRequestSchema,
} from "@chronologity/contracts";
import { defineOperation } from "./operation.js";

/**
 * Finding things.
 *
 * **Search is REST and stays REST**, which `roadmap.md:1082` assigns here
 * deliberately: its query, filter, sort-mode, cursor and match-reason types
 * belong alongside the rest of the API surface rather than in the Timeline's
 * GraphQL. What this package owns is the operation; the types have always lived
 * in `packages/contracts`.
 *
 * **A result is a pointer, not a permission.** Opening one reauthorises against
 * current state, and the aggregator refuses a destination that has since become
 * private or unfindable. A client must not cache a result as evidence that
 * something is still reachable.
 *
 * **A search cursor is not a Timeline cursor** and the two must never be crossed:
 * one names a position in one answer to one question under one ranking, the
 * other a position in chronology.
 */

/** Search across Moments, people, occasions and places. */
export const search = defineOperation({
  method: "GET",
  template: "/search",
  query: searchRequestSchema,
  response: searchPageSchema,
});

/**
 * Autocomplete, for the things you navigate to.
 *
 * Never Moments: a caption is the most sensitive text this system holds, and a
 * surface answering every keystroke is the worst place to put it. Rate limited
 * more tightly than search, because walking the alphabet through it is a way of
 * asking what exists.
 */
export const suggest = defineOperation({
  method: "GET",
  template: "/search/suggestions",
  query: searchSuggestRequestSchema,
  response: searchSuggestionsSchema,
});
