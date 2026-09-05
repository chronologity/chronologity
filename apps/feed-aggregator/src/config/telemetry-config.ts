import type { Env } from "./env.js";

/**
 * Where this service sends what it observed about itself.
 *
 * ADR-046 chose OpenTelemetry as the instrumentation layer and left the backend
 * open, so this names a collector and nothing about what sits behind it. The
 * collector is the seam: it receives, and where it forwards to is an operational
 * choice this application never learns.
 */
export interface TelemetryConfig {
  /**
   * The OTLP endpoint, or undefined to emit nothing.
   *
   * **Absence is the off switch**, rather than a separate flag. A boolean beside
   * an endpoint has two ways to say "off" and one way for them to disagree —
   * enabled with nowhere to send, which fails at the first export rather than at
   * startup.
   */
  readonly endpoint: string | undefined;
  /**
   * What this service calls itself in telemetry.
   *
   * Fixed rather than configured: it is the name every dashboard and every trace
   * joins on, and a deployment able to change it can silently split one
   * service's history in two.
   */
  readonly serviceName: "feed-aggregator";
}

/**
 * Derive telemetry settings from the environment.
 *
 * @param env - The validated environment.
 * @returns Where to send telemetry, if anywhere.
 */
export function toTelemetryConfig(env: Env): TelemetryConfig {
  return {
    ...(env.FEED_AGGREGATOR_OTLP_ENDPOINT === undefined
      ? { endpoint: undefined }
      : { endpoint: env.FEED_AGGREGATOR_OTLP_ENDPOINT }),
    serviceName: "feed-aggregator",
  };
}
