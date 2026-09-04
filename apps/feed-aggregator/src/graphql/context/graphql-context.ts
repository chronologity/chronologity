import type { Viewer } from "../../auth/auth-context.js";
import type { RequestEligibility } from "../../auth/request-eligibility.js";
import type { Logger } from "../../observability/logger.js";
import type { ContextAxisReadModel } from "../../read-models/clickhouse/context-axis-read-model.js";
import type { ContextNameReadModel } from "../../read-models/postgres/context-name-read-model.js";
import type { MomentReadModel } from "../../read-models/postgres/moment-read-model.js";
import type { RealWorldEventReadModel } from "../../read-models/postgres/real-world-event-read-model.js";
import type { RepresentativeReadModel } from "../../read-models/postgres/representative-read-model.js";
import type { TimelineReadModel } from "../../read-models/clickhouse/timeline-read-model.js";

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
   * The read model rather than the client it wraps, deliberately. On the context
   * so a resolver cannot reach a store the request was not given, and narrowed
   * to a read model so a resolver cannot write SQL at all — which `feed.md:256`
   * forbids, and which a raw client on the context would quietly permit.
   */
  readonly timeline: TimelineReadModel;
  /**
   * Where a Moment's own detail is read from.
   *
   * PostgreSQL rather than the Timeline projection, because the projection holds
   * what chronology needs and deliberately not what a Moment says. Opening one
   * is the only read in this service that touches the authoritative tables, and
   * it happens when somebody taps a Moment rather than while they scroll.
   */
  readonly moments: MomentReadModel;
  /**
   * Where the horizontal axis is found.
   *
   * ClickHouse, because the question is which contexts a Moment belongs to and
   * that is what the projection's membership table holds.
   */
  readonly contextAxis: ContextAxisReadModel;
  /**
   * Where a context is given back its name, and where a place is confirmed.
   *
   * PostgreSQL, because the projection deliberately holds no names — and
   * because whether a place may be named at all depends on what a Moment
   * disclosed, which is not a fact the projection carries.
   */
  readonly contextNames: ContextNameReadModel;
  /**
   * Where an occurrence is read from.
   *
   * PostgreSQL, and gated by whether this reader may see a Moment that was part
   * of it — the same derived rule the API applies, from the same package.
   */
  readonly realWorldEvents: RealWorldEventReadModel;
  /**
   * Where the Moments standing for a span of history are chosen.
   *
   * PostgreSQL, because significance, occurrence and the authoritative
   * visibility rule all live there — so choosing is one statement rather than a
   * projection that would have to carry a score the schema refuses to show.
   */
  readonly representatives: RepresentativeReadModel;
  /**
   * What this Viewer may see, resolved on demand and once per scope.
   *
   * On the context rather than constructed by each resolver, so that one
   * response cannot hold two answers to the same question — and so a resolver
   * cannot reach eligibility for a Viewer other than the one this request
   * established.
   *
   * Asking it refuses a request with no account: reading history requires one
   * (`moments.md:589`).
   */
  readonly eligibility: RequestEligibility;
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
