import type { ViewerFacts } from "@chronologity/timeline-derivation";
import type { GraphQLContext } from "../../graphql/context/graphql-context.js";
import type {
  ContextPosition,
  ContextRow,
} from "../../read-models/clickhouse/context-axis-read-model.js";
import { axisFor, edgesFor, type AxisConnection, type AxisEdge } from "../services/context-axis.js";
import { axisRequestFrom, type AxisArguments, type AxisRequest } from "../services/context-request.js";

/**
 * Moving sideways from where somebody is standing.
 *
 * The axis runs in two tiers and a page may straddle the join between them, so
 * this walks the first, and when it runs out mid-page continues into the second.
 * At most two reads of the axis, and only on the page where the boundary falls.
 *
 * Names come from PostgreSQL in one further read, because ClickHouse holds
 * membership and ordering and deliberately not what anything is called. That
 * read is also where a place is confirmed: some Moment tying it here has to have
 * disclosed where it happened, or the reader has to be its author.
 *
 * Because confirming can drop candidates, the tiers are asked for more than the
 * page needs and the result is trimmed — the probe-and-trim every other
 * connection here uses, never a loop that widens until it fills.
 */

/** How much to over-ask, so dropped candidates do not shorten a page. */
const SLACK = 2;

/**
 * A stretch of the horizontal axis.
 *
 * @param args - Where the reader is standing, when, and how much they want.
 * @param context - Carries the Viewer, what they may see, and the read models.
 * @returns The contexts they can move to, shared history first.
 * @throws {ValidationError} If the scope is a person, the identifier is not one,
 *   the page is outside the contract's bound, or the cursor is another
 *   connection's.
 * @throws {UnauthenticatedError} If the request offered no credential.
 * @throws {OnboardingRequiredError} If onboarding is unfinished.
 */
export async function getAdjacentContexts(
  args: AxisArguments,
  context: GraphQLContext,
): Promise<AxisConnection> {
  const request = axisRequestFrom(args);
  const viewer = await context.eligibility.forScope(request.scope);
  const facts = await context.eligibility.forViewer();

  const gathered: AxisEdge[] = [];
  let more = false;

  // Tier one, unless a cursor says that tier is already behind us.
  if (request.from === undefined || request.from.tier === "shared") {
    const slice = await context.contextAxis.sharedHistory(
      request.scope,
      viewer,
      request.limit * SLACK,
      positionOf(request),
    );

    gathered.push(...(await named(slice.rows, "shared", request, context, facts)));
    more = slice.more;
  }

  // Tier two, when the first did not fill the page. A page that straddles the
  // boundary crosses it exactly once, which is why this is a second read rather
  // than a loop.
  if (gathered.length < request.limit) {
    const resuming = request.from?.tier === "period" ? positionOf(request) : undefined;
    const slice = await context.contextAxis.samePeriod(
      request.scope,
      viewer,
      request.at,
      request.limit * SLACK,
      resuming,
    );

    gathered.push(...(await named(slice.rows, "period", request, context, facts)));
    more = slice.more;
  }

  const page = gathered.slice(0, request.limit);

  return axisFor(page, more || gathered.length > request.limit, request.from !== undefined);
}

/**
 * Where the read models resume from.
 *
 * @param request - The request, carrying the decoded cursor.
 * @returns The position, or undefined at the start of a tier.
 */
function positionOf(request: AxisRequest): ContextPosition | undefined {
  return request.from === undefined
    ? undefined
    : {
        shared: request.from.shared,
        latest: request.from.latest,
        contextType: request.from.contextType,
        contextId: request.from.contextId,
      };
}

/**
 * Name what may be named, and drop the rest.
 *
 * @param rows - What the axis found.
 * @param tier - Which tier they came from.
 * @param request - The anchor a place must be tied to by a disclosing Moment.
 * @param context - Carries the read model.
 * @param facts - Who is asking, and whether they are old enough for
 *   age-restricted history. Taken already resolved rather than read off the
 *   request's Viewer, so the account refusal happens once.
 * @returns The edges that survived confirmation.
 * @throws {Error} If PostgreSQL refuses a statement.
 */
async function named(
  rows: readonly ContextRow[],
  tier: "shared" | "period",
  request: AxisRequest,
  context: GraphQLContext,
  facts: ViewerFacts,
): Promise<AxisEdge[]> {
  if (rows.length === 0) {
    return [];
  }

  const names = await context.contextNames.name(
    rows.map((row) => ({ contextType: row.context_type, contextId: row.context_id })),
    { contextType: request.scope.type, contextId: request.scope.id },
    tier,
    facts.viewerUserId,
    facts.isAdult,
  );

  return edgesFor(rows, names, tier);
}
