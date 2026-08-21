// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { parseArgs } from "node:util";
import { ConfigurationError } from "@chronologity/config";
import { grantableRoleSchema } from "@chronologity/contracts";
import { loadConfig } from "../config/app-config.js";
import { AuthorizationRepository } from "../features/authorization/authorization.repository.js";
import { AuthorizationService } from "../features/authorization/authorization.service.js";
import { normalizeHandle } from "../features/users/user.handle-policy.js";
import { connectDatabase, createDatabase } from "../lib/database/postgres.js";
import { generateTraceId } from "../lib/ids/generate-trace-id.js";
import { systemContext } from "../types/request-context.js";

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
  const { handle, role: roleArgument, reason, remove } = values;

  if (handle === undefined || roleArgument === undefined) {
    process.stderr.write(usage);
    process.exit(1);
  }

  // Checked by hand rather than with `parse`, so a typo produces one usable
  // line rather than a validation object dumped at whoever ran the command.
  const parsedRole = grantableRoleSchema.safeParse(roleArgument);

  if (!parsedRole.success) {
    process.stderr.write(`Unknown role "${roleArgument}"\n${usage}`);
    process.exit(1);
  }

  const role = parsedRole.data;
  const config = loadConfig();
  const database = createDatabase(config.database);
  await connectDatabase(database);

  try {
    const rows: { user_id: string }[] = await database.dataSource.query(
      `SELECT user_id FROM user_handles WHERE normalized_handle = $1 AND released_at IS NULL`,
      [normalizeHandle(handle)],
    );

    const userId = rows[0]?.user_id;

    if (userId === undefined) {
      process.stderr.write(`No account currently holds @${handle}\n`);
      process.exit(1);
    }

    const authorization = new AuthorizationService(
      database.dataSource,
      new AuthorizationRepository(database.dataSource),
    );
    // System context: no actor, because there is no acting User. That is the
    // whole point of this command, and the audit row says so.
    const context = systemContext(generateTraceId(), new Date());
    // Recorded on the audit row so that a grant with no acting User is
    // explicable years later rather than merely anonymous.
    const why = reason ?? "granted from the command line";

    const changed = remove
      ? await authorization.remove(userId, role, undefined, why, context)
      : await authorization.assign(userId, role, undefined, why, context);

    const verb = remove ? "removed from" : "granted to";
    process.stdout.write(
      changed
        ? `Role ${role} ${verb} @${handle} (${userId})\n`
        : `No change: @${handle} ${remove ? "does not hold" : "already holds"} ${role}\n`,
    );
  } finally {
    await database.close();
  }
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Role change failed: ${String(error)}\n`);
  }
  process.exit(1);
}
