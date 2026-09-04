import type { FragmentDefinitionNode, GraphQLResolveInfo, SelectionSetNode } from "graphql";

/**
 * Whether a query asked for a particular field anywhere beneath a root one.
 *
 * **One read, at the root.** A field costing a statement of its own is normally
 * resolved where it sits, but a distribution's representatives are chosen for
 * every span in a single statement — so the decision has to be made once, before
 * that statement is issued, rather than per span. Asking the selection set is
 * what makes "one statement per store, however many spans come back" true rather
 * than aspirational.
 *
 * Fragments are followed, because a client that asks through one is asking. A
 * fragment already visited is not followed twice: the schema forbids a cycle,
 * but this runs on a document that has been parsed rather than fully validated,
 * and looping forever is a worse answer than any wrong one.
 *
 * The match is by name and ignores where in the tree the field sits. That is
 * sufficient for its single use and deliberately not general — a field name that
 * meant two different things at two depths would need a path, and would be worth
 * refusing rather than supporting.
 *
 * @param info - What the resolver was handed about this query.
 * @param name - The field to look for, as the schema spells it.
 * @returns Whether it appears anywhere under this root field.
 */
export function selectsField(info: GraphQLResolveInfo, name: string): boolean {
  const visited = new Set<string>();

  const walk = (selectionSet: SelectionSetNode | undefined): boolean => {
    if (selectionSet === undefined) {
      return false;
    }

    for (const selection of selectionSet.selections) {
      if (selection.kind === "Field") {
        if (selection.name.value === name || walk(selection.selectionSet)) {
          return true;
        }

        continue;
      }

      if (selection.kind === "InlineFragment") {
        if (walk(selection.selectionSet)) {
          return true;
        }

        continue;
      }

      const spread: string = selection.name.value;

      if (visited.has(spread)) {
        continue;
      }

      visited.add(spread);

      const fragment: FragmentDefinitionNode | undefined = info.fragments[spread];

      if (fragment !== undefined && walk(fragment.selectionSet)) {
        return true;
      }
    }

    return false;
  };

  return info.fieldNodes.some((node) => walk(node.selectionSet));
}
