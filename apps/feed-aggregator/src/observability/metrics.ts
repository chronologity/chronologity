import { metrics, type Attributes } from "@opentelemetry/api";

/**
 * Counting what this service does.
 *
 * `observability.md:687-699` lists what the aggregator should expose, and the
 * list reads as thirteen instruments. It is not: most of those entries are one
 * measurement seen through a different dimension. Request count and query
 * duration differ by aggregation, not by subject; Timeline slice latency,
 * temporal zoom latency, historical jump latency and Moment depth latency are
 * one histogram with an `operation` label. **Six instruments carry all thirteen
 * signals**, and six instruments is a set somebody can hold in their head while
 * reading a dashboard.
 *
 * **The dimensions are bounded, and that is the constraint doing the work.**
 * `observability.md:410-414` forbids `userId`, `momentId`, `eventId` and
 * `requestId` as labels, because a label with one value per account is a
 * separate time series per account — a store that grows with the product and
 * answers nothing. Those belong in traces and logs, which is where this service
 * puts them.
 *
 * **The `operation` label is the trap in that rule**, and it is closed here
 * deliberately. `observability.md:422` permits `operation`, and the obvious
 * reading is the GraphQL operation name — but that is a string the client wrote.
 * `query A`, `query B`, `query ' + Date.now() + '` are three series and there is
 * no limit. So the label is the **root field the document selected**, which the
 * schema bounds absolutely: seven values today, and a new one only when somebody
 * adds a root field.
 */

/**
 * The instruments, resolved lazily so a meter provider registered later is used.
 *
 * @returns The meter every instrument below is created against.
 */
const meter = () => metrics.getMeter("chronologity.feed-aggregator");

/**
 * What a request was for, and how it ended.
 *
 * Both bounded: `operation` comes from the schema rather than from the document,
 * and `outcome` is one of three.
 */
export interface RequestDimensions extends Attributes {
  /** The root field selected, or `other` for a document selecting none. */
  readonly operation: string;
  /** `answered`, `refused` — the client's document — or `failed`. */
  readonly outcome: "answered" | "refused" | "failed";
}

/**
 * How long a request took, end to end.
 *
 * Seconds rather than milliseconds, following `observability.md:397`'s
 * `chronologity_feed_query_duration_seconds`. The unit is part of the name in
 * every convention worth following, and a histogram whose name says seconds and
 * whose values are milliseconds is wrong in a way no dashboard reveals.
 *
 * @returns The histogram of end-to-end request time.
 */
const duration = () =>
  meter().createHistogram("chronologity_feed_query_duration_seconds", {
    description: "How long a GraphQL request took to answer, by root field and outcome.",
    unit: "s",
  });

/**
 * How many requests arrived, by what they asked for and how they ended.
 *
 * @returns The counter of requests, by root field and outcome.
 */
const requests = () =>
  meter().createCounter("chronologity_feed_requests_total", {
    description: "GraphQL requests, by root field and outcome.",
  });

/**
 * How long the stores took, separately from how long the service took.
 *
 * The one number that distinguishes "this service is slow" from "this service is
 * waiting", which `aggregator-read-baseline.json` already records per scenario
 * and which nothing has ever recorded in production.
 *
 * @returns The histogram of time spent inside a datastore.
 */
const storeDuration = () =>
  meter().createHistogram("chronologity_feed_store_duration_seconds", {
    description: "Time spent inside a datastore, by store.",
    unit: "s",
  });

/**
 * How many keys a batch carried.
 *
 * `feed.md:1289` asks for it and ADR-146 recorded why it could not be given:
 * "this service has no metrics pipeline at all… a structured log line per
 * dispatch carries the field today, so 9K has something to scrape rather than
 * something to instrument." This is that.
 *
 * @returns The histogram of keys per batch.
 */
const batchSize = () =>
  meter().createHistogram("chronologity_feed_loader_batch_size", {
    description: "Keys per DataLoader dispatch, by loader.",
  });

/**
 * How often a document was refused before it ran.
 *
 * `observability.md:699` asks for complexity rejection specifically, and the
 * same instrument carries every other admission refusal — depth, and the rate
 * limit — because the operational question is one question: is something being
 * turned away, and by which rule.
 *
 * @returns The counter of documents refused before execution.
 */
const refusals = () =>
  meter().createCounter("chronologity_feed_refused_total", {
    description: "Documents refused before execution, by which bound refused them.",
  });

/**
 * How far behind the projection is.
 *
 * `feed.md:1218` requires that this service "expose enough telemetry to
 * distinguish stale from empty", and without this it cannot: a Timeline holding
 * nothing and a Timeline whose projection stopped advancing are the same empty
 * page. Recorded as an observable gauge because it is a level rather than an
 * event — nobody wants the history of a lag, only its current value.
 *
 * @param read - How to find out. Called on each collection, and may answer
 *   undefined when nothing is projected at all.
 * @returns Nothing.
 */
export function observeProjectionLag(read: () => Promise<number | undefined>): void {
  meter()
    .createObservableGauge("chronologity_feed_projection_lag_seconds", {
      description: "Age of the newest projected row. Absent when nothing is projected.",
      unit: "s",
    })
    .addCallback(async (result) => {
      const seconds = await read();

      // Absent rather than zero when there is nothing projected at all. Zero
      // would read as perfectly fresh, which is the opposite of what an empty
      // projection means.
      if (seconds !== undefined) {
        result.observe(seconds);
      }
    });
}

/**
 * Record a finished request.
 *
 * @param dimensions - What it asked for and how it ended.
 * @param seconds - How long it took, in seconds.
 * @returns Nothing.
 */
export function recordRequest(dimensions: RequestDimensions, seconds: number): void {
  duration().record(seconds, dimensions);
  requests().add(1, dimensions);
}

/**
 * Record time spent inside a store.
 *
 * @param store - Which one. Two values, and it must stay that way.
 * @param seconds - How long, in seconds.
 * @returns Nothing.
 */
export function recordStore(store: "postgres" | "clickhouse", seconds: number): void {
  storeDuration().record(seconds, { store });
}

/**
 * Record a batch dispatch.
 *
 * @param loader - Which loader dispatched. Bounded by how many exist.
 * @param keys - How many keys it carried. Never which.
 * @returns Nothing.
 */
export function recordBatch(loader: string, keys: number): void {
  batchSize().record(keys, { loader });
}

/**
 * Record a document turned away before it ran.
 *
 * @param bound - Which rule refused it: `depth`, `cost`, or `rate`.
 * @returns Nothing.
 */
export function recordRefusal(bound: "depth" | "cost" | "rate"): void {
  refusals().add(1, { bound });
}
