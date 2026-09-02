// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../config/app-config.js";
import { composeApp } from "../server/compose.js";

/**
 * Write the OpenAPI document.
 *
 * Builds the application exactly as the process does — through `composeApp`,
 * not through a second wiring — and reads the routes back out of it. That is
 * what makes the document provably describe what the server serves: a route
 * registered in one and not the other cannot exist.
 *
 * Connects to nothing. Repositories hold an uninitialised DataSource without
 * querying it, so this runs with no database, no broker, and no storage.
 *
 * Configuration comes from `.env.example` rather than the environment, which
 * makes this hermetic: the document describes routes, and routes do not depend
 * on anybody's credentials. A continuous-integration job can generate it after
 * a checkout with nothing configured.
 *
 * It also means generating the document checks that `.env.example` still covers
 * every variable the application requires — a missing one fails here, loudly,
 * rather than on somebody's first run.
 */

/** Where the document lives, committed so a contract change shows up in review. */
const SPEC_PATH = fileURLToPath(new URL("../../openapi.json", import.meta.url));

/** The committed example, which is required to stay complete. */
const EXAMPLE_ENV_PATH = fileURLToPath(new URL("../../../../.env.example", import.meta.url));

/**
 * Read the example environment as a plain record.
 *
 * @param contents - The file, as written.
 * @returns Every assignment in it. Comments and blank lines are ignored, and a
 *   value is taken verbatim so that quoting is whatever the file says.
 */
function parseEnv(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const line of contents.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());

    if (match?.[1] !== undefined) {
      parsed[match[1]] = match[2] ?? "";
    }
  }

  return parsed;
}

try {
  const config = loadConfig(parseEnv(await readFile(EXAMPLE_ENV_PATH, "utf8")));

  // Never production: that is the environment where the document is
  // deliberately absent, and generating from it would produce an empty file.
  const { app } = await composeApp({ ...config, nodeEnv: "development" });

  await app.ready();

  const spec = app.swagger();
  const paths = Object.keys((spec as { paths?: Record<string, unknown> }).paths ?? {});

  await writeFile(SPEC_PATH, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  await app.close();

  process.stdout.write(`Wrote ${paths.length} paths to openapi.json\n`);
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Could not write the specification: ${String(error)}\n`);
  }
  process.exit(1);
}
