import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contractRegistry } from "@chronologity/contracts";
import { describe, it } from "vitest";
import type { Arguments, Operation } from "./operation.js";
import * as operations from "./index.js";

/**
 * Every route the API declares can be called from here.
 *
 * **The one test that notices what nobody wrote.** A hundred and sixty-three
 * operations written by hand is a hundred and sixty-three chances to skip one,
 * and skipping one is invisible: the package compiles, every test passes, and
 * the gap only appears when a screen needs the route that is missing.
 *
 * So the check reads an inventory this package did not write —
 * `apps/api/openapi.json`, regenerated from the routes themselves and compared
 * in CI (ADR-112) — and reconciles it against what is offered here. That is the
 * job the document is genuinely good for, and the reason ADR-152 keeps
 * generating it while declining to generate the client *from* it.
 *
 * It checks shape as well as existence, because an operation pointing at the
 * right path with the wrong body is a subtler version of the same mistake.
 */

/** A documented operation is exempt only with a reason, and none are. */
const EXEMPT: ReadonlyArray<{ method: string; path: string; reason: string }> = [];

interface Documented {
  readonly method: string;
  readonly path: string;
  readonly hasBody: boolean;
  readonly hasQuery: boolean;
  /**
   * The name the document gives this route's success body, where it names one.
   *
   * Undefined where the shape is written inline, which is the case for the
   * handful of one-off bodies the registry deliberately does not name.
   */
  readonly answers: string | undefined;
}

/** One operation as the document describes it. */
interface DocumentedOperation {
  requestBody?: unknown;
  parameters?: Array<{ in: string }>;
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

/**
 * The component name a documented success response refers to.
 *
 * @param operation - The operation as the document describes it.
 * @returns The name, or undefined where the document writes the shape inline or
 *   the success is empty.
 */
function successShape(operation: DocumentedOperation): string | undefined {
  const responses = operation.responses ?? {};
  const status = Object.keys(responses)
    .filter((code) => code.startsWith("2"))
    .sort()[0];

  if (status === undefined) {
    return undefined;
  }

  const schema = responses[status]?.content?.["application/json"]?.schema;

  if (typeof schema !== "object" || schema === null || !("$ref" in schema)) {
    return undefined;
  }

  const reference = (schema as { $ref: unknown }).$ref;

  return typeof reference === "string" ? reference.replace("#/components/schemas/", "") : undefined;
}

/**
 * Read the published document.
 *
 * @returns Every operation it declares.
 */
function documented(): Documented[] {
  const path = fileURLToPath(new URL("../../../../apps/api/openapi.json", import.meta.url));
  const document = JSON.parse(readFileSync(path, "utf8")) as {
    paths: Record<string, Record<string, DocumentedOperation>>;
  };

  const found: Documented[] = [];

  for (const [route, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) {
        continue;
      }

      found.push({
        method: method.toUpperCase(),
        path: route,
        hasBody: operation.requestBody !== undefined,
        hasQuery: (operation.parameters ?? []).some((one) => one.in === "query"),
        answers: successShape(operation),
      });
    }
  }

  return found;
}

/**
 * Read what this package offers.
 *
 * @returns Every operation, keyed by method and documented path. Templates are
 *   spelled `:name` and the document spells them `{name}`; the same route either
 *   way, so one is rewritten into the other rather than compared loosely.
 */
function offered(): Map<string, Operation<Arguments, unknown>> {
  const found = new Map<string, Operation<Arguments, unknown>>();

  for (const [feature, module] of Object.entries(operations)) {
    if (typeof module !== "object" || module === null) {
      continue;
    }

    for (const [name, value] of Object.entries(module)) {
      if (typeof value !== "function" || !("template" in value)) {
        continue;
      }

      const operation = value as Operation<Arguments, unknown>;
      const path = operation.template.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      const key = `${operation.method} ${path}`;

      assert.equal(
        found.has(key),
        false,
        `${key} is offered twice, the second as ${feature}.${name}`,
      );
      found.set(key, operation);
    }
  }

  return found;
}

describe("offering every route the API declares", () => {
  const declared = documented();
  const available = offered();

  it("finds a document to check against", () => {
    assert.ok(declared.length > 0, "openapi.json declared no operations");
  });

  it("offers a way to call every documented operation", () => {
    const exempt = new Set(EXEMPT.map((one) => `${one.method} ${one.path}`));

    const missing = declared
      .map((one) => `${one.method} ${one.path}`)
      .filter((key) => !available.has(key) && !exempt.has(key));

    assert.deepEqual(missing, [], `${missing.length} documented operations cannot be called`);
  });

  it("offers nothing the document does not declare", () => {
    // The other direction, and it matters as much: an operation naming a route
    // that no longer exists compiles perfectly and fails at runtime.
    const known = new Set(declared.map((one) => `${one.method} ${one.path}`));

    const invented = [...available.keys()].filter((key) => !known.has(key));

    assert.deepEqual(
      invented,
      [],
      `${invented.length} operations name a route the API does not serve`,
    );
  });

  it("sends a body exactly where one is declared", () => {
    const wrong = declared
      .filter((one) => {
        const operation = available.get(`${one.method} ${one.path}`);

        return operation !== undefined && operation.sendsBody !== one.hasBody;
      })
      .map((one) => `${one.method} ${one.path} declares body=${one.hasBody}`);

    assert.deepEqual(wrong, []);
  });

  it("sends a query string exactly where one is declared", () => {
    const wrong = declared
      .filter((one) => {
        const operation = available.get(`${one.method} ${one.path}`);

        return operation !== undefined && operation.sendsQuery !== one.hasQuery;
      })
      .map((one) => `${one.method} ${one.path} declares query=${one.hasQuery}`);

    assert.deepEqual(wrong, []);
  });

  it("fills every placeholder the path carries", () => {
    // A template with a `:name` and no builder would send the placeholder
    // literally, and the server would answer 400 for a route that exists.
    const unfilled = [...available.entries()]
      .filter(([, operation]) => operation.template.includes(":"))
      .filter(([, operation]) => {
        const names = [...operation.template.matchAll(/:([A-Za-z0-9_]+)/g)].map(
          (match) => match[1] ?? "",
        );
        const params = Object.fromEntries(names.map((name) => [name, "filled"]));

        return operation.pathFor({ params }).includes(":");
      })
      .map(([key]) => key);

    assert.deepEqual(unfilled, []);
  });

  it("retries nothing that is not safe to repeat", () => {
    const unsafe = [...available.entries()]
      .filter(([, operation]) => operation.idempotent)
      .filter(([, operation]) => !["GET", "HEAD", "PUT", "DELETE"].includes(operation.method))
      .map(([key]) => key);

    // `POST /uploads/{uploadId}/finalize` is the one the API documents as
    // idempotent. Anything else appearing here is a Moment recorded twice.
    assert.deepEqual(unsafe, ["POST /uploads/{uploadId}/finalize"]);
  });

  it("parses the response against the shape the document names", () => {
    // The subtler half of the same mistake: an operation on the right path with
    // the wrong schema compiles, calls the right route, and returns something
    // the caller cannot use. Only checkable because the registry gives the
    // shapes public names, which is what Part 1 fixed.
    const wrong = declared
      .filter((one) => one.answers !== undefined)
      .filter((one) => {
        const operation = available.get(`${one.method} ${one.path}`);
        const named = contractRegistry._idmap.get(String(one.answers));

        return operation !== undefined && named !== undefined && operation.response !== named;
      })
      .map((one) => `${one.method} ${one.path} answers ${String(one.answers)}`);

    assert.deepEqual(wrong, []);
  });

  it("checks enough responses for that to mean something", () => {
    // Guards the test above from passing because the document names nothing.
    const named = declared.filter((one) => one.answers !== undefined).length;

    assert.ok(named >= 100, `only ${named} of ${declared.length} responses are named`);
  });

  it("exempts nothing without a reason", () => {
    for (const one of EXEMPT) {
      assert.ok(one.reason.length > 20, `${one.method} ${one.path} is exempt without a reason`);
    }
  });
});
