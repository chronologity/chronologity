import { logLevelSchema, nodeEnvSchema, portSchema } from "@chronologity/config";
import { z } from "zod";

/**
 * The aggregator's environment contract.
 *
 * Every variable this application reads is declared here, and it is a short
 * list by intent. A read service that needed the API's twelve subsystems would
 * be a second API; this one needs two stores and the means to verify a token.
 *
 * Defaults exist only for values that are safe to guess locally. Connection
 * targets and the signing secret have none: a missing ClickHouse URL must stop
 * the process, not silently point it somewhere plausible.
 *
 * The names are shared with `apps/api` where the thing named is the same thing —
 * one PostgreSQL, one ClickHouse, one signing secret. Renaming them per
 * application would mean a local `.env` carrying two spellings of one value,
 * which drift.
 */
export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,

  FEED_AGGREGATOR_HOST: z.string().min(1).default("0.0.0.0"),
  // Not 3000: this runs alongside the API in development, and two services
  // fighting over a port is a confusing way to learn that.
  FEED_AGGREGATOR_PORT: portSchema.default(4000),

  /**
   * How deep a GraphQL document may nest before it is refused.
   *
   * A read schema with reciprocal edges — a Moment naming a Location naming its
   * Moments — can be nested into an arbitrarily expensive query by anybody who
   * can send one. Configuration rather than a constant because the right bound
   * depends on how deep the schema actually grows, and that is still growing.
   */
  FEED_AGGREGATOR_GRAPHQL_MAX_DEPTH: z.coerce.number().int().min(1).max(100).default(12),

  CLICKHOUSE_URL: z.string().min(1),
  CLICKHOUSE_DATABASE: z.string().min(1),
  CLICKHOUSE_USERNAME: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string().min(1),

  /**
   * Which Timeline projection version this process reads.
   *
   * Carried even though this phase issues no Timeline query, because ADR-129
   * makes it the one variable every reader, the projector and the erasure
   * worker all honour. A reader that acquired queries without it would read a
   * version nobody is maintaining, and would do so silently.
   *
   * Required here rather than defaulted, unlike in the API: the API owns the
   * constant that names the current version, and this application must not
   * carry a second copy of it that could disagree.
   */
  TIMELINE_PROJECTION_VERSION: z.string().min(1),

  /**
   * Which Search index version this process asks about.
   *
   * Read to answer one question and no other: whether a thing somebody says
   * they found is still findable. Documents for two versions live side by side
   * while a rebuild runs, so naming the wrong one would answer about an index
   * nobody is serving.
   *
   * Required rather than defaulted, for the reason the projection version is:
   * `apps/api` owns the constant naming the current version, and a default here
   * would be a second copy of it that could disagree without anybody noticing.
   * A cutover moves the API first and this after, which degrades safely —
   * documents for the old version outlive the cutover, so a lagging reader gets
   * a stale answer rather than refusing every arrival.
   */
  SEARCH_INDEX_VERSION: z.string().min(1),

  /**
   * Where to send traces and metrics, or nothing at all.
   *
   * Optional, and absence means this process emits nothing — which is what a
   * test run and a bare `pnpm dev` want, and what keeps a missing collector from
   * being a startup failure. ADR-046 settled the instrumentation layer; the
   * backend behind this endpoint is deliberately not this application's concern.
   */
  FEED_AGGREGATOR_OTLP_ENDPOINT: z.string().min(1).optional(),

  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: portSchema,
  POSTGRES_DATABASE: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string(),

  // Verification only. This application signs nothing, so it needs the secret
  // to check a signature and no token lifetime at all — the API decides how
  // long a token lasts and the expiry travels inside it.
  AUTH_JWT_SECRET: z.string().min(16),
  AUTH_JWT_ISSUER: z.string().min(1).default("chronologity"),
  AUTH_JWT_AUDIENCE: z.string().min(1).default("chronologity-clients"),
});

export type Env = z.infer<typeof envSchema>;
