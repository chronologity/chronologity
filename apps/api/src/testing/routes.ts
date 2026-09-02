import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Every route this application declares, read from where they are declared.
 *
 * The authorization suites are table-driven, and a table nothing checks is a
 * table that rots: a route added with its guard forgotten, or added without an
 * ownership test, is exactly the change these suites exist to catch and exactly
 * the change a hand-maintained list would miss.
 *
 * Read from source rather than from the built application, which was the first
 * choice and does not work. Fastify's `onRoute` hook fires only for routes
 * registered after it is added, and `buildApp` registers every route inside
 * itself — so a hook a test adds afterwards sees nothing, and no public API
 * reports a route's `preHandler` once it is registered. What is available after
 * the fact is `printRoutes`, which gives methods and paths and says nothing
 * about guards.
 *
 * So: the declarations, parsed. The weakness is that it reads text rather than
 * behaviour, and a route registered some other way would be invisible. That is
 * checked rather than assumed — `routes.test.ts` compares this against what the
 * built application reports, so the scan cannot quietly drift from the truth.
 */

/** How a route is declared, and what guards it. */
export interface DeclaredRoute {
  readonly method: string;
  /** The path as Fastify sees it, parameters included. */
  readonly path: string;
  /** The feature directory that owns it. */
  readonly feature: string;
  /**
   * The permission it requires, if any.
   *
   * Both guards are found: `requirePermission`, and `guardRecording` in
   * `moderation.routes.ts`, which refuses identically and writes an audit
   * record first. Counting only the former is how a survey concluded that two
   * of the five permissions were unenforced.
   */
  readonly permission: string | undefined;
}

const FEATURES = fileURLToPath(new URL("../features", import.meta.url));

/**
 * A route declaration, and everything up to the next one.
 *
 * Deliberately greedy to the next declaration rather than to a closing brace:
 * the guard sits in the options object between the path and the handler, and
 * counting braces through template literals and regular expressions is a worse
 * problem than this needs to solve.
 */
const DECLARATION = /app\.(get|post|put|patch|delete)\(\s*\n?\s*"([^"]+)"/g;
const GUARD = /(?:requirePermission|guardRecording)\(\s*\n?\s*"([a-z:-]+)"/;

/**
 * Read every route the features declare.
 *
 * @returns One entry per declaration, in file then declaration order.
 * @throws {Error} If no routes are found at all, which means the scan has
 *   stopped matching how routes are written and every table it feeds would
 *   otherwise pass vacuously.
 */
export function declaredRoutes(): readonly DeclaredRoute[] {
  const found: DeclaredRoute[] = [];

  for (const feature of readdirSync(FEATURES, { withFileTypes: true })) {
    if (!feature.isDirectory()) continue;

    for (const file of readdirSync(`${FEATURES}/${feature.name}`)) {
      if (!file.endsWith(".routes.ts")) continue;

      const source = readFileSync(`${FEATURES}/${feature.name}/${file}`, "utf8");
      const starts = [...source.matchAll(DECLARATION)];

      for (const [index, match] of starts.entries()) {
        const from = match.index + match[0].length;
        const to = starts[index + 1]?.index ?? source.length;

        found.push({
          method: match[1]!.toUpperCase(),
          path: match[2]!,
          feature: feature.name,
          permission: GUARD.exec(source.slice(from, to))?.[1],
        });
      }
    }
  }

  if (found.length === 0) {
    throw new Error("No routes found. The scan no longer matches how routes are declared.");
  }

  return found;
}

/**
 * How a route is named in a table.
 *
 * @param route - The route.
 * @returns Method and path, which together identify it.
 */
export function nameOf(route: { method: string; path: string }): string {
  return `${route.method} ${route.path}`;
}
