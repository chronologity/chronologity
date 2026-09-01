import type { ClickHouseClient } from "@clickhouse/client";
import type { Viewer } from "../../auth/auth-context.js";
import type { Logger } from "../../observability/logger.js";

/**
 * What every resolver receives.
 *
 * Built once per request and passed down, rather than reached for. A read
 * service composes one response from several queries, and each of them has to
 * agree about who is asking; the way to guarantee that is for there to be one
 * Viewer in scope for the request rather than a lookup each resolver performs.
 *
 * Nothing viewer-specific is ever held outside this object. `feed.md:402`
 * forbids putting one person's authorization context where another request can
 * reach it, and in a service whose whole job is deciding what somebody may see,
 * that would be the worst available bug.
 */
export interface GraphQLContext {
  /** Who is asking. Resolved from credentials, never from what a client claims. */
  readonly viewer: Viewer;
  /** Correlates every query this request makes, across the logs. */
  readonly traceId: string;
  /** Already carrying the trace identifier, so resolvers need not add it. */
  readonly log: Logger;
  /**
   * Where Timeline history is read from.
   *
   * On the context rather than imported by each resolver, so that a resolver
   * cannot reach a store the request was not given — and so a test can give it
   * a different one.
   */
  readonly clickhouse: ClickHouseClient;
  /** Which projection version this process reads. Every query names it. */
  readonly projectionVersion: string;
}

/**
 * Teach Mercurius what this application's context holds.
 *
 * Mercurius types every resolver's context as `MercuriusContext`, which knows
 * about the Fastify instance and reply and nothing else. Declaring the addition
 * here rather than casting in each resolver means a resolver that reaches for a
 * field the context does not carry fails to compile, which is the whole reason
 * for having the type.
 */
declare module "mercurius" {
  // Empty by design: the whole point is to merge this application's context
  // fields into Mercurius's, and restating them here would create a second
  // declaration that could drift from the first.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface MercuriusContext extends GraphQLContext {}
}
