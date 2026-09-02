// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { parseArgs } from "node:util";
import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../config/app-config.js";
import { connectDatabase, createDatabase } from "../lib/database/postgres.js";
import { grantRole } from "./grant-role.command.js";

/**
 * Grant or remove a platform role from the command line.
 *
 * This exists because of a bootstrapping problem: assigning a role requires
 * `admin:user-role-manage`, which only an administrator holds, and at the
 * beginning there is no administrator. Something outside the permission system
 * has to make the first one.
 *
 * That something is deliberately not an HTTP endpoint and not an environment
 * variable. Here, authority comes from access to the database and the
 * deployment — the same authority that could rewrite the roles table
 * directly — rather than from a running process that could be reached, or a
 * config value that could be mistyped into a silent escalation. The change is
 * audited exactly like any other, with no acting User and the reason recorded.
 *
 * This file parses arguments and chooses an exit code. Every decision lives in
 * `grant-role.command.ts`, where it can be tested.
 */

const { values } = parseArgs({
  options: {
    handle: { type: "string" },
    role: { type: "string" },
    reason: { type: "string" },
    remove: { type: "boolean", default: false },
  },
});

const usage =
  "Usage: grant-role --handle <handle> --role <moderator|administrator> [--reason <text>] [--remove]\n";

try {
  const config = loadConfig();
  const database = createDatabase(config.database);
  await connectDatabase(database);

  let refused = false;

  try {
    const outcome = await grantRole(values, database.dataSource);

    if (outcome.kind === "refused") {
      process.stderr.write(`${outcome.message}\n${usage}`);
      refused = true;
    } else {
      process.stdout.write(`${outcome.message}\n`);
    }
  } finally {
    await database.close();
  }

  // After the connection is closed, not instead of closing it.
  if (refused) {
    process.exit(1);
  }
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Role change failed: ${String(error)}\n`);
  }
  process.exit(1);
}
