import { grantableRoleSchema } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { AuthorizationRepository } from "../features/authorization/authorization.repository.js";
import { AuthorizationService } from "../features/authorization/authorization.service.js";
import { normalizeHandle } from "../features/users/user.handle-policy.js";
import { generateTraceId } from "../lib/ids/generate-trace-id.js";
import { systemContext } from "../types/request-context.js";

/**
 * What somebody typed on the command line, before any of it is trusted.
 *
 * Every field is optional because `parseArgs` cannot require one, and a
 * missing argument has to produce a usable line rather than a crash.
 */
export interface GrantRoleArguments {
  readonly handle?: string;
  readonly role?: string;
  readonly reason?: string;
  readonly remove: boolean;
}

/**
 * What happened, and what to tell whoever ran the command.
 *
 * Three outcomes rather than two, because "no change" is neither a success
 * worth celebrating nor a failure worth a non-zero exit: the state asked for
 * already holds.
 */
export type GrantRoleOutcome =
  | { readonly kind: "changed"; readonly message: string }
  | { readonly kind: "unchanged"; readonly message: string }
  | { readonly kind: "refused"; readonly message: string };

/** Written on the audit row when nobody said why. */
const DEFAULT_REASON = "granted from the command line";

/**
 * Grant or remove a platform role, named by handle.
 *
 * Separated from the entry point so that it can be tested. The shell around it
 * parses arguments and chooses an exit code; every decision is here.
 *
 * Authority comes from reaching the database at all, which is the same
 * authority that could rewrite the roles table by hand. There is no acting
 * User, and the audit row says so rather than merely leaving it blank.
 *
 * @param options - What was typed, unvalidated.
 * @param dataSource - The database to act on.
 * @returns What happened and what to print. A refusal is returned rather than
 *   thrown: a mistyped role is an ordinary outcome of running a command, not
 *   an exceptional one.
 * @throws {NotFoundError} If the handle resolves to an account that no longer
 *   exists, which would mean the handle outlived its owner.
 */
export async function grantRole(
  options: GrantRoleArguments,
  dataSource: DataSource,
): Promise<GrantRoleOutcome> {
  if (options.handle === undefined || options.role === undefined) {
    return { kind: "refused", message: "A handle and a role are both required" };
  }

  // Checked by hand rather than with `parse`, so a typo produces one usable
  // line rather than a validation object dumped at whoever ran the command.
  const parsedRole = grantableRoleSchema.safeParse(options.role);

  if (!parsedRole.success) {
    return { kind: "refused", message: `Unknown role "${options.role}"` };
  }

  const role = parsedRole.data;

  // The live holder of the handle, not whoever held it once. A released handle
  // may since have been taken by somebody else, and granting on the strength of
  // an old claim would hand a role to the wrong account.
  const rows: { user_id: string }[] = await dataSource.query(
    `SELECT user_id FROM user_handles WHERE normalized_handle = $1 AND released_at IS NULL`,
    [normalizeHandle(options.handle)],
  );

  const userId = rows[0]?.user_id;

  if (userId === undefined) {
    return { kind: "refused", message: `No account currently holds @${options.handle}` };
  }

  const authorization = new AuthorizationService(
    dataSource,
    new AuthorizationRepository(dataSource),
  );
  // System context: no actor, because there is no acting User. That is the
  // whole point of this command, and the audit row says so.
  const context = systemContext(generateTraceId(), new Date());
  const why = options.reason ?? DEFAULT_REASON;

  const changed = options.remove
    ? await authorization.remove(userId, role, undefined, why, context)
    : await authorization.assign(userId, role, undefined, why, context);

  if (!changed) {
    return {
      kind: "unchanged",
      message: `No change: @${options.handle} ${
        options.remove ? "does not hold" : "already holds"
      } ${role}`,
    };
  }

  return {
    kind: "changed",
    message: `Role ${role} ${options.remove ? "removed from" : "granted to"} @${
      options.handle
    } (${userId})`,
  };
}
