import assert from "node:assert/strict";
import { buildSchema, parse, validate } from "graphql";
import { describe, it } from "vitest";
import { loadSchema } from "../load-schema.js";
import { costLimit, TOO_EXPENSIVE } from "./cost-rule.js";

/**
 * What one document may cost.
 *
 * Every case here is a shape the statement-count suites already measured, so
 * these are not opinions about cost — they are the measurements, restated where
 * a document is refused rather than where a statement is counted. If one of
 * these numbers is wrong, the corresponding integration suite disagrees with it
 * and one of the two is lying.
 *
 * The rule this exists to protect is ADR-146's: "This phase makes repetition
 * cheap; it does not make it permitted."
 */

const schema = buildSchema(loadSchema());

/**
 * Validate a document against a ceiling.
 *
 * @param document - The query text.
 * @param maxCost - The ceiling, in statements.
 * @returns The refusal messages, empty when the document was admitted.
 */
function refusals(document: string, maxCost: number): string[] {
  return validate(schema, parse(document), [costLimit(maxCost)]).map((error) => error.message);
}

/** A document opening `count` Moments and asking each for everything. */
const opening = (count: number): string =>
  `query Open {\n${Array.from(
    { length: count },
    (_unused, index) =>
      `  m${index}: moment(id: "00000000-0000-4000-8000-00000000000${index % 10}") {
         media(first: 10) { edges { node { mediaId } } }
         comments(first: 10) { total edges { node { commentId } } }
         reactions { total }
         relationships { relationshipId }
       }`,
  ).join("\n")}\n}`;

describe("what one document may cost", () => {
  it("charges a Timeline page one read", async () => {
    assert.deepEqual(refusals("{ timeline(view: {scope: {type: PERSON, id: \"x\"}}) { edges { cursor } } }", 1), []);
  });

  it("charges a landing two, because it reads either side", async () => {
    // `timelineAround` returns two pages. A model charging it as one would
    // admit twice the work it priced.
    const document = `{ timelineAround(view: {scope: {type: PERSON, id: "x"}}, anchor: {instant: "2014-05-01T00:00:00Z"}) { anchoredAt } }`;

    assert.deepEqual(refusals(document, 2), []);
    assert.equal(refusals(document, 1).length, 1);
  });

  it("charges ten aliased Moments once, because the loader answers them once", async () => {
    // The measured fact that makes a naive per-alias model wrong: ten aliases
    // of a batched root cost one statement, asserted in
    // `batched-statement-count.integration.test.ts`.
    const document = `query Ten {\n${Array.from(
      { length: 10 },
      (_unused, index) => `  m${index}: moment(id: "00000000-0000-4000-8000-00000000000${index}") { caption }`,
    ).join("\n")}\n}`;

    assert.deepEqual(refusals(document, 1), []);
  });

  it("charges each Moment for the fields hanging off it", async () => {
    // And this is why the budget exists at all: the aliases are free, what they
    // ask for is not. Two Moments asking for everything is 1 + 2 x 5.
    assert.deepEqual(refusals(opening(2), 11), []);
    assert.equal(refusals(opening(2), 10).length, 1);
  });

  it("admits counting ten discussions, which is a real thing a client does", async () => {
    // The shape `aggregator-read-baseline.json` records at fourteen statements.
    // A budget refusing it would be refusing the product.
    const document = `query Counts {\n${Array.from(
      { length: 10 },
      (_unused, index) =>
        `  m${index}: moment(id: "00000000-0000-4000-8000-00000000000${index}") { comments(first: 1) { total } }`,
    ).join("\n")}\n}`;

    assert.deepEqual(refusals(document, 21), []);
  });

  it("refuses two hundred Moments opened in full", async () => {
    // The shape nothing bounded before this phase: a thousand statements in one
    // request, answered without complaint.
    const messages = refusals(opening(200), 100);

    assert.equal(messages.length, 1);
    assert.ok(messages[0]?.startsWith(TOO_EXPENSIVE));
  });

  it("says how far over the document went, so a client can decide what to drop", async () => {
    const messages = refusals(opening(200), 100);

    assert.ok(messages[0]?.includes("1001"), messages[0]);
    assert.ok(messages[0]?.includes("100"), messages[0]);
  });

  it("charges a fragment where it is spread, and twice when spread twice", async () => {
    // Otherwise moving a selection into a fragment would be a way to buy it for
    // nothing, which is the oldest hole in every cost limiter.
    const document = `query F {
      a: timeline(view: {scope: {type: PERSON, id: "x"}}) { ...page }
      b: timeline(view: {scope: {type: PERSON, id: "y"}}) { ...page }
    }
    fragment page on TimelineConnection { edges { cursor } }`;

    assert.deepEqual(refusals(document, 2), []);
    assert.equal(refusals(document, 1).length, 1);
  });

  it("costs nothing for a document that asks for nothing expensive", async () => {
    assert.deepEqual(refusals("{ viewer { userId authenticated } }", 0), []);
  });
});
