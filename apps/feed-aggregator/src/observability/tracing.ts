import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import type { TelemetryConfig } from "../config/telemetry-config.js";

/**
 * Saying where a request spent its time.
 *
 * **One span per composition stage, never one per request.** `feed.md:1311` is
 * explicit — "avoid one opaque resolver span" — and the reason is that the
 * question worth answering is never *was this slow* but *which part of it was*.
 * A Timeline page resolves eligibility in PostgreSQL, reads history from
 * ClickHouse and enriches through the loaders, and those three have entirely
 * different reasons to be slow.
 *
 * The stages are the ones `feed.md:1303-1308` names, and they are stages this
 * code already has rather than a structure invented to match a document:
 *
 * ```text
 * resolve timeline
 *   ├── decode cursor
 *   ├── resolve eligibility (PostgreSQL)
 *   ├── query timeline (ClickHouse)
 *   ├── batch enrich (PostgreSQL, request-scoped loaders)
 *   └── map GraphQL response
 * ```
 *
 * **Instrumented by hand rather than automatically**, which is the smaller
 * choice as well as the correcter one. Automatic instrumentation of Fastify
 * produces exactly the opaque request span the document forbids, and four more
 * packages to produce it.
 *
 * **Nothing a Viewer supplied goes into a span.** `observability.md:475` forbids
 * raw GraphQL variables, the same rule the logger already applies to logs, and
 * for the stronger reason: a span carrying a caption or a coordinate is private
 * data in a second store nobody is treating as one.
 */

/** The tracer every stage opens against. */
const tracer = trace.getTracer("chronologity.feed-aggregator");

/**
 * A running SDK, or the absence of one.
 *
 * Held so the process can flush on shutdown. Telemetry that is buffered when a
 * pod is replaced is telemetry about the interesting minute, lost.
 */
export interface Telemetry {
  /** Flush and stop. Safe to call when nothing was started. */
  shutdown(): Promise<void>;
}

/**
 * Start emitting traces and metrics, if anywhere was configured to send them.
 *
 * **One SDK for both signals**, because they share the thing that must not
 * disagree: the resource. Two SDKs would each name the service, and a
 * deployment where the traces say `feed-aggregator` and the metrics say
 * something else is one where no dashboard can join them.
 *
 * @param config - Where to send them, and what to call this service.
 * @returns A handle that flushes on shutdown. When no endpoint is configured
 *   this is a working no-op rather than null, so no call site has to ask whether
 *   telemetry is on — the spans and instruments are still created and simply go
 *   nowhere.
 */
export function startTelemetry(config: TelemetryConfig): Telemetry {
  if (config.endpoint === undefined) {
    return { shutdown: async () => undefined };
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: config.serviceName }),
    traceExporter: new OTLPTraceExporter({ url: `${config.endpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${config.endpoint}/v1/metrics` }),
    }),
    // Deliberately none. Automatic instrumentation would wrap Fastify and `pg`
    // in spans this service did not choose the shape of, and the shape is the
    // point.
    instrumentations: [],
  });

  sdk.start();

  return { shutdown: () => sdk.shutdown() };
}

/**
 * Run something as a named stage of the request that contains it.
 *
 * The only way this application opens a span. A helper rather than reaching for
 * the tracer at each call site, because three things have to be right every time
 * and only one of them is interesting: the span must end even when the work
 * throws, a failure must be recorded on it rather than swallowed, and the work
 * must run inside the span's context so anything it opens nests beneath.
 *
 * @param name - What this stage is, from a fixed vocabulary rather than built
 *   from data — a span name carrying an identifier makes every trace a unique
 *   one and every aggregate empty.
 * @param work - The stage. Its value is returned untouched.
 * @param attributes - Safe dimensions only: scale, direction, how many keys a
 *   batch carried. Never a caption, a coordinate, a cursor or a variable.
 * @returns Whatever the work returned.
 * @throws Whatever the work threw, after marking the span failed. Nothing is
 *   caught here: an observed failure is still a failure.
 */
export function withSpan<T>(
  name: string,
  work: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  return tracer.startActiveSpan(name, { ...(attributes && { attributes }) }, async (span) => {
    try {
      return await work(span);
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        // The class, not the message. A driver's message can carry a fragment of
        // the statement that failed, and a statement carries identifiers.
        ...(error instanceof Error && { message: error.name }),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
