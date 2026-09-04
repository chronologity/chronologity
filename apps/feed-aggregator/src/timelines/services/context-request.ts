import { identifierSchema, listAdjacentContextsRequestSchema } from "@chronologity/contracts";
import type { TimelineScopeRef } from "@chronologity/timeline-derivation";
import { ValidationError } from "../../errors/aggregator-error.js";
import { expectKind, type Position } from "../../pagination/cursors.js";
import { CONTEXT_TYPES, type GraphQLScopeType } from "./timeline-request.js";

/**
 * What a client asked for when moving sideways.
 *
 * The bound comes from the contract rather than a number written beside the
 * field, and the cursor arrives already decoded but not yet checked — one
 * scalar serves four connections, so a Timeline cursor reaches this argument as
 * readily as a context one and would decode to something plausible.
 */

/** Where the reader is standing, as the schema names it. */
export interface ContextScopeArguments {
  readonly type: GraphQLScopeType;
  readonly id: string;
}

/** How far along the axis, and how much of it. */
export interface AxisArguments {
  readonly scope: ContextScopeArguments;
  readonly at: Date;
  readonly first?: number | null;
  readonly after?: Position | null;
}

/** Where a tier resumes, as the read models take it. */
export interface AxisResume {
  readonly tier: "shared" | "period";
  readonly shared: number;
  readonly latest: Date;
  readonly contextType: string;
  readonly contextId: string;
}

/** An axis request, bounded and checked. */
export interface AxisRequest {
  readonly scope: TimelineScopeRef;
  readonly at: Date;
  readonly limit: number;
  readonly from: AxisResume | undefined;
}

/**
 * Read what a client asked for.
 *
 * @param args - The arguments the field was given.
 * @returns The bounded, checked request.
 * @throws {ValidationError} If the scope is a person, the identifier is not one,
 *   the page size is outside the contract's bound, or the cursor belongs to a
 *   different connection.
 */
export function axisRequestFrom(args: AxisArguments): AxisRequest {
  // Refused rather than answered empty, and that distinction matters. "Which
  // places and occasions does this person's history touch" is a whole-life
  // location trace, and an empty answer would itself be a claim about them —
  // the same reason a place is refused a lens only a person has rather than
  // quietly given `ALL`.
  if (args.scope.type === "PERSON") {
    throw new ValidationError("A person's history is not somewhere you can stand and look sideways");
  }

  if (!identifierSchema.safeParse(args.scope.id).success) {
    throw new ValidationError("That is not a context identifier");
  }

  const first = args.first ?? undefined;
  const parsed = listAdjacentContextsRequestSchema.safeParse(
    first === undefined ? {} : { limit: first },
  );

  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "That is not a usable page");
  }

  const supplied = args.after ?? undefined;
  const position = supplied === undefined ? undefined : expectKind(supplied, "context");

  return {
    scope: { type: CONTEXT_TYPES[args.scope.type], id: args.scope.id },
    at: args.at,
    limit: parsed.data.limit,
    from:
      position === undefined
        ? undefined
        : {
            tier: position.tier,
            shared: position.shared,
            latest: position.latest,
            contextType: position.contextType,
            contextId: position.contextId,
          },
  };
}
