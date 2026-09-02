import type { ViewSpecification } from "@chronologity/contracts";

/**
 * Turning a View Specification into what the projection needs.
 *
 * The specification is product vocabulary — a context, a lens, a stretch of
 * time. This is the one place that becomes SQL, which is what keeps the
 * specification free of anything datastore-shaped: `roadmap.md:800` forbids a
 * table, a column or a query expression appearing in an object that will be
 * stored by Saved Views and reopened against an engine nobody has written yet.
 *
 * Everything here narrows. Nothing here decides what a Viewer may see — that is
 * `eligible()`, which no specification can weaken, because a saved view is a
 * request and never a grant.
 */

/** Extra conditions and the parameters they read. */
export interface ViewNarrowing {
  /** SQL fragments, each already parenthesised, to be joined with `AND`. */
  readonly conditions: readonly string[];
  readonly params: Record<string, unknown>;
}

/** Nothing to narrow by. */
const NOTHING: ViewNarrowing = { conditions: [], params: {} };

/**
 * Resolve a temporal range to the instants it means right now.
 *
 * A fixed range is the interval it always was. A rolling one is counted back
 * from this moment, which is why its definition rather than its dates is what a
 * Saved View stores: "the last thirty days" reopened in December must mean
 * December's thirty days, and a range resolved when it was saved would silently
 * have become a fixed one.
 *
 * @param range - What the specification asks for.
 * @param now - Injected so a test can pin what "now" means.
 * @returns The interval, or undefined when the view names no range.
 */
export function resolveRange(
  range: ViewSpecification["range"],
  now: Date = new Date(),
): { from: Date; to: Date } | undefined {
  if (range === undefined) {
    return undefined;
  }

  if (range.kind === "fixed") {
    return { from: new Date(range.from), to: new Date(range.to) };
  }

  const from = new Date(now);

  switch (range.unit) {
    case "day":
      from.setUTCDate(from.getUTCDate() - range.count);
      break;
    case "month":
      from.setUTCMonth(from.getUTCMonth() - range.count);
      break;
    case "year":
      from.setUTCFullYear(from.getUTCFullYear() - range.count);
      break;
  }

  return { from, to: now };
}

/**
 * What a specification narrows the projection by.
 *
 * @param view - The specification.
 * @param alias - The table the conditions are written against.
 * @param version - Which projection version the subquery reads. Taken rather
 *   than assumed: the fragment names `{version: String}`, and until this was a
 *   parameter it was bound by whichever repository happened to call — which
 *   worked only because both of them did, and would have failed silently for a
 *   third caller that did not.
 * @param now - Injected so a rolling range can be pinned in a test.
 * @returns Conditions and parameters, empty when the view narrows nothing.
 */
export function narrowingFor(
  view: ViewSpecification,
  alias: string,
  version: string,
  now: Date = new Date(),
): ViewNarrowing {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  // The lens. Only a person's Timeline has more than one, and the schema
  // refuses anything else — so this reads the context rather than trusting the
  // perspective alone.
  if (view.context.type === "person" && view.perspective !== "all") {
    // Authorship is the whole difference. A person's context rows are written
    // for what they recorded *and* for what they agreed to, and the author
    // column is what tells the two apart without a second table.
    conditions.push(
      view.perspective === "authored"
        ? `${alias}.author_user_id = {viewPerson: String}`
        : `${alias}.author_user_id != {viewPerson: String}`,
    );
    params.viewPerson = view.context.id;
  }

  if (view.filters.authorUserId !== undefined) {
    conditions.push(`${alias}.author_user_id = {viewAuthor: String}`);
    params.viewAuthor = view.filters.authorUserId;
  }

  // A place or an occasion, read from the same table under a different context.
  // A subquery rather than a join: the outer query is already ordered and paged
  // by the sort key, and joining would cost that ordering.
  for (const [filter, type, key] of [
    [view.filters.locationId, "location", "viewLocation"],
    [view.filters.realWorldEventId, "real_world_event", "viewEvent"],
  ] as const) {
    if (filter !== undefined) {
      conditions.push(
        `${alias}.moment_id IN (
           SELECT moment_id FROM timeline_moment_contexts
            WHERE projection_version = {version: String}
              AND context_type = '${type}'
              AND context_id = {${key}: String}
         )`,
      );
      params[key] = filter;
      // Bound here rather than left to the caller. The condition above names it,
      // so the function that writes the condition is what owes the value.
      params.version = version;
    }
  }

  const range = resolveRange(view.range, now);

  if (range !== undefined) {
    // Occurrence, always. A range is a stretch of history, and history is when
    // things happened rather than when somebody got round to recording them.
    conditions.push(
      `${alias}.occurred_at >= {viewFrom: DateTime64(3)}`,
      `${alias}.occurred_at <= {viewTo: DateTime64(3)}`,
    );
    params.viewFrom = range.from;
    params.viewTo = range.to;
  }

  return conditions.length === 0 ? NOTHING : { conditions, params };
}

/**
 * The narrowing as a SQL fragment.
 *
 * @param narrowing - What to narrow by.
 * @returns A fragment beginning with `AND`, or the empty string.
 */
export function narrowingSql(narrowing: ViewNarrowing): string {
  return narrowing.conditions.length === 0
    ? ""
    : `AND ${narrowing.conditions.map((condition) => `(${condition})`).join(" AND ")}`;
}
