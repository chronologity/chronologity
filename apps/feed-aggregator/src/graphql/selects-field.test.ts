import assert from "node:assert/strict";
import { parse, type FragmentDefinitionNode, type GraphQLResolveInfo, type OperationDefinitionNode } from "graphql";
import { describe, it } from "vitest";
import { selectsField } from "./selects-field.js";

/**
 * Reading the selection set once, at the root.
 *
 * What this decides is whether a second store is queried at all, so a wrong
 * answer is either a wasted statement or a field that comes back empty because
 * nobody went to look. The fragment cases are the ones that matter: a client
 * asking through a fragment is asking, and a query that loops would be worse
 * than either wrong answer.
 */

/** Build the part of `info` this reads, from a query somebody could send. */
const infoFor = (query: string): GraphQLResolveInfo => {
  const document = parse(query);
  const operation = document.definitions.find(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === "OperationDefinition",
  );
  const fragments = Object.fromEntries(
    document.definitions
      .filter(
        (definition): definition is FragmentDefinitionNode =>
          definition.kind === "FragmentDefinition",
      )
      .map((fragment) => [fragment.name.value, fragment]),
  );

  assert.ok(operation, "the probe query has no operation");

  return {
    fieldNodes: operation.selectionSet.selections.filter(
      (selection) => selection.kind === "Field",
    ),
    fragments,
  } as unknown as GraphQLResolveInfo;
};

describe("selectsField", () => {
  it("finds a field asked for directly", () => {
    assert.equal(
      selectsField(infoFor("{ temporalDistribution { representatives { momentId } } }"), "representatives"),
      true,
    );
  });

  it("finds a field nested below another", () => {
    assert.equal(
      selectsField(
        infoFor("{ temporalDistribution { buckets { representatives { momentId } } } }"),
        "representatives",
      ),
      true,
    );
  });

  it("does not find a field nobody asked for", () => {
    assert.equal(
      selectsField(infoFor("{ temporalDistribution { buckets { startsAt count } } }"), "representatives"),
      false,
    );
  });

  it("follows an inline fragment, because asking through one is asking", () => {
    assert.equal(
      selectsField(
        infoFor(`{
          temporalDistribution {
            buckets { ... on TemporalBucket { representatives { momentId } } }
          }
        }`),
        "representatives",
      ),
      true,
    );
  });

  it("follows a named fragment", () => {
    assert.equal(
      selectsField(
        infoFor(`{
          temporalDistribution { buckets { ...span } }
        }
        fragment span on TemporalBucket { representatives { momentId } }`),
        "representatives",
      ),
      true,
    );
  });

  it("follows a fragment reached through another fragment", () => {
    assert.equal(
      selectsField(
        infoFor(`{
          temporalDistribution { buckets { ...outer } }
        }
        fragment outer on TemporalBucket { ...inner }
        fragment inner on TemporalBucket { representatives { momentId } }`),
        "representatives",
      ),
      true,
    );
  });

  it("says no when a fragment names something else", () => {
    assert.equal(
      selectsField(
        infoFor(`{
          temporalDistribution { buckets { ...span } }
        }
        fragment span on TemporalBucket { startsAt count }`),
        "representatives",
      ),
      false,
    );
  });

  it("does not loop on a fragment that refers back to itself", () => {
    // The schema forbids this and validation would refuse it, but this reads a
    // parsed document rather than a validated one, and looping forever is worse
    // than any wrong answer.
    assert.equal(
      selectsField(
        infoFor(`{
          temporalDistribution { buckets { ...loop } }
        }
        fragment loop on TemporalBucket { ...loop }`),
        "representatives",
      ),
      false,
    );
  });

  it("says no when a fragment was named but never defined", () => {
    assert.equal(
      selectsField(
        infoFor("{ temporalDistribution { buckets { ...missing } } }"),
        "representatives",
      ),
      false,
    );
  });

  it("says no for a root field with nothing beneath it", () => {
    assert.equal(selectsField(infoFor("{ viewer { authenticated } }"), "representatives"), false);
  });
});
