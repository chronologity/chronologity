import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { interpretResults, type PlaceSearchClient } from "./place-search-client.js";

/**
 * Answering place searches from recorded results.
 *
 * Used by tests, so the suite never calls OpenStreetMap. Two reasons, and the
 * second is the important one.
 *
 * The obvious reason is reliability: a test that depends on someone else's
 * service fails when they are slow, rate-limit us, or change a field. The
 * better reason is courtesy — the public service is run by volunteers and asks
 * for at most one request a second, which a test suite would blow through
 * without noticing.
 *
 * The recordings are real responses, captured once and committed. That matters
 * more than it might seem: a stand-in built from what I assumed the service
 * returns would test my assumptions rather than the service. The real
 * responses revealed, for instance, that the field a place is named by is
 * sometimes absent and the full description has to stand in for it.
 *
 * One opt-in test exercises the real service, so a change in what it returns
 * is discovered deliberately rather than in production.
 */

const RECORDINGS: Readonly<Record<string, string>> = {
  "madison square garden": "madison-square-garden.json",
  reykjavik: "reykjavik.json",
};

const ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0";

/**
 * Build a client that answers from recorded responses.
 *
 * @returns A client that never makes a network request, interpreting its
 *   recordings with the same code the live client uses.
 */
export function createRecordedPlaceSearchClient(): PlaceSearchClient {
  return {
    async search(query, limit = 5) {
      const file = RECORDINGS[query.trim().toLowerCase()] ?? "no-results.json";
      const path = fileURLToPath(new URL(`./__fixtures__/${file}`, import.meta.url));
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;

      return {
        suggestions: interpretResults(raw).slice(0, limit),
        attribution: ATTRIBUTION,
      };
    },
  };
}
