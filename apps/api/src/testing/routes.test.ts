import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { declaredRoutes, nameOf } from "./routes.js";

/**
 * Whether reading the route declarations sees what the application registers.
 *
 * The authorization tables are only as good as the list they are checked
 * against, and that list is parsed out of source rather than reported by a
 * running Fastify — which would be worthless if the parsing quietly stopped
 * matching how routes are written. A scan that found nothing, or half of them,
 * would make every table above it pass by covering an empty set.
 *
 * `openapi.json` is the control. It is generated from the fully built
 * application by `pnpm spec:generate`, and CI fails if it is out of date, so it
 * is an independent statement of which routes exist — produced by Fastify
 * itself rather than by this parser.
 */

interface OpenApiDocument {
  readonly paths: Record<string, Record<string, unknown>>;
}

const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/** Every operation the generated document describes, named as Fastify names it. */
function documentedOperations(): Set<string> {
  const document = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../openapi.json", import.meta.url)), "utf8"),
  ) as OpenApiDocument;

  const operations = new Set<string>();

  for (const [path, item] of Object.entries(document.paths)) {
    // OpenAPI writes `{momentId}` where Fastify writes `:momentId`.
    const fastify = path.replaceAll(/\{([^}]+)\}/g, ":$1");

    for (const method of Object.keys(item)) {
      if (METHODS.has(method.toLowerCase())) {
        operations.add(`${method.toUpperCase()} ${fastify}`);
      }
    }
  }

  return operations;
}

describe("reading the route declarations", () => {
  it("finds every operation the application documents, and no others", () => {
    const scanned = new Set(declaredRoutes().map(nameOf));
    const documented = documentedOperations();

    assert.deepEqual(
      [...scanned].filter((route) => !documented.has(route)).sort(),
      [],
      "the scan found routes the application does not register",
    );
    assert.deepEqual(
      [...documented].filter((route) => !scanned.has(route)).sort(),
      [],
      "the application registers routes the scan cannot see",
    );
  });

  it("finds the guard on a route that has one", () => {
    // Both guards, because only one of them is called what a person would grep
    // for, and missing the other is how two of the five permissions came to
    // look unenforced.
    const guarded = declaredRoutes().filter((route) => route.permission !== undefined);
    const byName = new Map(guarded.map((route) => [nameOf(route), route.permission]));

    assert.equal(
      byName.get("GET /moderation/reports"),
      "moderation:report-review",
      "requirePermission was not read",
    );
    assert.equal(
      byName.get("PUT /users/:userId/suspension"),
      "moderation:account-suspend",
      "guardRecording was not read",
    );
  });

  it("finds no guard on a route that has none", () => {
    const open = declaredRoutes().find((route) => nameOf(route) === "POST /reports");

    assert.equal(open?.permission, undefined, "a route open to anybody looks guarded");
  });
});
