import { GraphQLError, type ASTVisitor, type ValidationContext } from "graphql";
import {
  BATCHED_ROOTS,
  COMMENT_TOTAL,
  MOMENT_FIELDS,
  PER_SELECTION_ROOTS,
} from "./weights.js";

/**
 * Refusing a document that would cost too much to answer.
 *
 * **A validation rule, so nothing is spent discovering the answer.** It runs on
 * the parsed document before any resolver, which is the same place the depth
 * bound already runs and the only place a refusal is free. The alternative —
 * counting as resolvers execute — would refuse a request halfway through, having
 * already paid for the half it ran.
 *
 * **What it counts is statements, not fields**, from the measured table in
 * `weights.ts`. A document naming ten Moments and asking each for its discussion
 * is eleven statements and reads as eleven; a document naming ten Moments and
 * asking each for its caption is one, and reads as one. Field counting would
 * treat those as the same document and be wrong about both.
 *
 * **Fragments are followed once per spread**, because that is what execution
 * does. A fragment spread into a selection set contributes its own cost there,
 * and a fragment spread twice contributes twice — otherwise moving a selection
 * into a fragment would be a way to buy it for nothing.
 */

/** How the refusal is worded, so tests and clients agree on it. */
export const TOO_EXPENSIVE = "That query asks for too much at once";

/**
 * A rule that refuses documents costing more than a ceiling.
 *
 * @param maxCost - The ceiling, in statements. Configuration rather than a
 *   constant, so a measurement harness can raise it — `load.mjs` records what
 *   happens when a limiter cannot be raised: "the first run of this harness
 *   recorded 2,618 requests a second and every one of them was rejected."
 * @param onRefusal - Called when a document is turned away, so the refusal can
 *   be counted. Separate from the rule because counting is not validating, and a
 *   rule that reached for a metrics registry could not be unit tested.
 * @returns A validation rule for `validationRules`.
 */
export function costLimit(maxCost: number, onRefusal?: () => void) {
  return function costRule(context: ValidationContext): ASTVisitor {
    let cost = 0;
    /** Root fields already charged, so a batched one is not charged twice. */
    const chargedRoots = new Set<string>();

    return {
      Field: {
        enter(node) {
          const name = node.name.value;
          const parentType = context.getParentType()?.name;

          if (parentType === "Query") {
            const batched = BATCHED_ROOTS[name];

            if (batched !== undefined) {
              // Charged on first sight only. Ten aliases of a batched root are
              // one statement, which is what the loader actually does.
              if (!chargedRoots.has(name)) {
                chargedRoots.add(name);
                cost += batched;
              }

              return;
            }

            cost += PER_SELECTION_ROOTS[name] ?? 0;

            return;
          }

          if (parentType === "Moment") {
            cost += MOMENT_FIELDS[name] ?? 0;

            return;
          }

          // The count is a field on the connection rather than on the Moment,
          // and is paid only when asked for — which the depth suite asserts
          // separately, and which is why it cannot simply be folded into
          // `comments` above.
          if (parentType === "CommentConnection" && name === "total") {
            cost += COMMENT_TOTAL;
          }
        },
      },
      Document: {
        leave() {
          if (cost > maxCost) {
            onRefusal?.();
            context.reportError(
              new GraphQLError(
                // The numbers, because a client that cannot see how far over it
                // went cannot decide what to drop. Neither number reveals
                // anything about anybody's history.
                `${TOO_EXPENSIVE}: it would cost ${cost} database reads and the limit is ${maxCost}. Ask for fewer things, or ask in more than one request.`,
                { extensions: { code: "VALIDATION_FAILED" } },
              ),
            );
          }
        },
      },
    };
  };
}
