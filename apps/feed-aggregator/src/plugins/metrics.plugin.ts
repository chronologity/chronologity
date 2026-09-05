import type { DocumentNode } from "graphql";
import type { MercuriusContext } from "mercurius";
import { recordRefusal, recordRequest } from "../observability/metrics.js";

/**
 * Measuring a request from the outside.
 *
 * Attached to Mercurius's own lifecycle rather than to Fastify's, because the
 * two answer different questions. A Fastify hook sees one POST to `/graphql`
 * and can say how long it took; it cannot say what it was for, and "how long
 * does a request to this service take" averaged over opening a Moment and
 * zooming out to four decades is a number with no meaning.
 *
 * **What a request was for is taken from the schema, not from the document.**
 * The GraphQL operation name is a string the client wrote, so using it as a
 * metric dimension hands the client control of how many time series exist —
 * `observability.md:405` forbids exactly this, and the obvious reading of its
 * own `operation` example is the thing it forbids. The root field selected is
 * bounded by the schema instead.
 */

/** What a document asked for and when it started, held for the length of one request. */
interface InFlight {
  operation: string;
  began: number;
}

/**
 * Per-request state, keyed on the context object itself.
 *
 * A `WeakMap` rather than a field on the context: the context is the shape
 * resolvers receive, and a mutable timing slot on it would be one more thing a
 * resolver could reach for. Nothing here outlives the request, because nothing
 * else holds the key.
 */
const inFlight = new WeakMap<MercuriusContext, InFlight>();

/**
 * The root field a document selected, or `other`.
 *
 * The first one, deliberately, rather than a set: a document naming several is
 * one request whose cost belongs somewhere, and spreading it across every field
 * it touched would count it more than once. Documents naming several root fields
 * are what the cost budget is for.
 *
 * @param document - The parsed document.
 * @returns The field name, or `other` when the document selects none — which a
 *   valid document cannot, but a malformed one reaching here should not throw.
 */
export function rootFieldOf(document: DocumentNode): string {
  for (const definition of document.definitions) {
    if (definition.kind !== "OperationDefinition") {
      continue;
    }

    for (const selection of definition.selectionSet.selections) {
      if (selection.kind === "Field") {
        return selection.name.value;
      }
    }
  }

  return "other";
}

/** What Mercurius exposes once it has registered. */
export interface Instrumentable {
  addHook(
    name: "preParsing",
    hook: (schema: unknown, source: string, context: MercuriusContext) => Promise<void>,
  ): void;
  addHook(
    name: "preValidation",
    hook: (schema: unknown, document: DocumentNode, context: MercuriusContext) => Promise<void>,
  ): void;
  addHook(
    name: "onResolution",
    hook: (execution: { errors?: readonly unknown[] }, context: MercuriusContext) => Promise<void>,
  ): void;
}

/**
 * Record how long each request took, and how it ended.
 *
 * Three hooks rather than one, because the three facts arrive at three
 * different moments: the clock starts before parsing, what was asked for is
 * known only after it, and how it ended only after execution.
 *
 * A document refused before execution — by depth, or by cost — never reaches
 * `onResolution`, so its refusal is counted where it happens rather than here.
 * That asymmetry is why `recordRefusal` exists separately: a bound that turns
 * work away leaves no request to measure.
 *
 * @param graphql - The registered Mercurius instance.
 * @returns Nothing.
 */
export function instrument(graphql: Instrumentable): void {
  graphql.addHook("preParsing", async (_schema, _source, context) => {
    inFlight.set(context, { operation: "other", began: performance.now() });
  });

  graphql.addHook("preValidation", async (_schema, document, context) => {
    const started = inFlight.get(context);

    if (started !== undefined) {
      started.operation = rootFieldOf(document);
    }
  });

  graphql.addHook("onResolution", async (execution, context) => {
    const started = inFlight.get(context);

    if (started === undefined) {
      return;
    }

    inFlight.delete(context);

    recordRequest(
      {
        operation: started.operation,
        // A GraphQL response carrying errors is not a failed request in the
        // transport sense — it answers 200 — but it is not an answered one
        // either, and a latency figure that mixed the two would be measuring
        // the cost of refusing alongside the cost of serving.
        outcome:
          execution.errors === undefined || execution.errors.length === 0 ? "answered" : "failed",
      },
      (performance.now() - started.began) / 1000,
    );
  });
}

export { recordRefusal };
