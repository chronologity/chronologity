import { REPRESENTATIVES_PER_SPAN, type TimelineScale, type ViewSpecification } from "@chronologity/contracts";
import { PositionalParameters, visibleToViewer } from "@chronologity/moment-access";
import { postgresSpanStart } from "@chronologity/timeline-derivation";
import type { Pool } from "pg";

/**
 * Choosing what a span of history was about.
 *
 * ClickHouse counts and PostgreSQL chooses, and the split is not an
 * optimisation. Historical significance lives in PostgreSQL, so does occurrence,
 * and so does the rule deciding what a Viewer may read — so choosing is one
 * statement here, while counting is one statement there, and they meet on the
 * span each row falls in. Both use the same span generator, which is why they
 * can meet at all.
 *
 * **Every representative is one the Viewer may read.** Not merely on other
 * people's Timelines — on their own too, where paging deliberately returns
 * Moments they may not read, redacted. A count and its page must agree, and they
 * do; a representative set is a different claim. A redacted entry carries an
 * identifier and two instants, which is enough to say *something happened here*
 * and not enough to say *this is what the span was about*. Since a span holds
 * only three, offering one would not add a row, it would take one from a Moment
 * that could actually speak for the span. And the ordering itself would be a
 * disclosure: "the most significant thing on your Timeline in 1998 is something
 * you may not read" is a statement about withheld content, drawn from a score
 * computed out of other people's history.
 */

/** A Moment standing for its span, and where it stands. */
export interface RepresentativeRow {
  /** The span it represents, as `date_trunc` and its arithmetic twin produce it. */
  readonly starts_at: Date;
  /** Its place in the span's ranking, one upwards. */
  readonly within_span: number;
  readonly moment_id: string;
  readonly occurrence_start: Date;
  readonly occurrence_end: Date;
  readonly occurrence_precision: string;
  readonly occurrence_offset_minutes: number;
  readonly visibility: string;
  readonly discoverable: boolean;
}

/**
 * Chooses the Moments that stand for each span of a stretch of history.
 */
export class RepresentativeReadModel {
  /**
   * Build the read model.
   *
   * @param pool - The read-only connection this application holds.
   */
  constructor(private readonly pool: Pool) {}

  /**
   * The Moments that speak for each span.
   *
   * **Two ranking passes, and the first is a product rule rather than a tidying
   * step.** One pass would let somebody who photographed a single afternoon
   * forty times fill a decade's summary with that afternoon — the zoomed-out
   * view would stop conveying shape, which is the only thing it exists to
   * convey. So each person is collapsed to their most significant Moment in the
   * span before the three are taken. It is written as SQL rather than applied to
   * the rows afterwards so that a later change to how these are assembled cannot
   * quietly drop it.
   *
   * The stretch and the narrowing come off the view, whose range was pinned to
   * fixed instants when the request was assembled — so this reads exactly the
   * history the count read, rather than resolving "the last thirty days" a
   * second time against a later clock.
   *
   * @param view - What is being read, carrying its scope, lens, filters and the
   *   resolved range.
   * @param scale - How coarsely to group, bucketed by the generator ClickHouse
   *   also uses.
   * @param viewerUserId - Who is asking.
   * @param viewerIsAdult - Whether they are old enough for age-restricted
   *   history.
   * @returns Representatives, oldest span first and best first within a span. A
   *   span whose history is entirely unreadable to this Viewer contributes
   *   nothing, which is why the count is the authority on which spans exist.
   * @throws {Error} If the view carries no fixed range, which means it was not
   *   assembled by the request builder.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async choose(
    view: ViewSpecification,
    scale: TimelineScale,
    viewerUserId: string,
    viewerIsAdult: boolean,
  ): Promise<readonly RepresentativeRow[]> {
    const range = view.range;

    if (range === undefined || range.kind !== "fixed") {
      throw new Error("A distribution needs a range already resolved to instants");
    }

    const bind = new PositionalParameters();
    const viewer = {
      viewerUserId: bind.bind(viewerUserId),
      viewerIsAdult: bind.bind(viewerIsAdult),
    };
    const from = bind.bind(range.from);
    const to = bind.bind(range.to);
    const span = postgresSpanStart(scale, "m.occurrence_start");

    const result = await this.pool.query<RepresentativeRow>(
      `WITH candidate AS (
         SELECT m.moment_id,
                m.author_user_id,
                m.occurrence_start,
                m.occurrence_end,
                m.occurrence_precision,
                m.occurrence_offset_minutes,
                m.visibility,
                m.discoverable,
                ${span} AS starts_at,
                -- The scope being zoomed, falling back to what history at large
                -- says. A Moment nothing has scored yet is not excluded; it
                -- scores nothing and sorts last, deterministically.
                COALESCE(scoped.total, global.total, 0) AS score
           FROM moments m
           LEFT JOIN LATERAL (
             SELECT sum(s.value) AS total
               FROM moment_significance s
              WHERE s.moment_id = m.moment_id
                AND s.scope_type = ${bind.bind(view.context.type)}
                AND s.scope_id = ${bind.bind(view.context.id)}
                -- **Never this dimension.** A 'personal' row is one person's
                -- private mark copied into the derived table, keyed to their own
                -- scope. Including it on a person's Timeline would make the
                -- order of representatives a readout of what they privately
                -- marked, shown to everybody who may open it. Ordering discloses
                -- exactly as a count does. Excluded unconditionally rather than
                -- for the person scope alone, because a rule that is off in one
                -- place is one refactor from being off everywhere.
                AND s.dimension <> 'personal'
           ) scoped ON true
           LEFT JOIN LATERAL (
             SELECT sum(s.value) AS total
               FROM moment_significance s
              WHERE s.moment_id = m.moment_id
                AND s.scope_type = 'global'
           ) global ON true
          WHERE m.deleted_at IS NULL
            AND m.occurrence_start >= ${from}::timestamptz
            AND m.occurrence_start <= ${to}::timestamptz
            AND ${membership(view, bind)}
            ${narrowing(view, bind)}
            AND ${visibleToViewer("m", viewer)}
       ),
       best_per_author AS (
         SELECT candidate.*,
                row_number() OVER (
                  PARTITION BY starts_at, author_user_id
                  ORDER BY score DESC, occurrence_start ASC, moment_id ASC
                ) AS within_author
           FROM candidate
       ),
       ranked AS (
         SELECT best_per_author.*,
                row_number() OVER (
                  PARTITION BY starts_at
                  ORDER BY score DESC, occurrence_start ASC, moment_id ASC
                ) AS within_span
           FROM best_per_author
          WHERE within_author = 1
       )
       -- Cast, because row_number() is bigint and this driver hands a bigint
       -- back as a string rather than a number.
       SELECT starts_at, within_span::int AS within_span, moment_id,
              occurrence_start, occurrence_end,
              occurrence_precision, occurrence_offset_minutes, visibility, discoverable
         FROM ranked
        WHERE within_span <= ${bind.bind(REPRESENTATIVES_PER_SPAN)}
        ORDER BY starts_at ASC, within_span ASC`,
      [...bind.values],
    );

    return result.rows;
  }
}

/**
 * Whether a Moment belongs to the Timeline being read.
 *
 * The one branch that differs by what kind of thing a Timeline is about. A
 * person's Timeline holds what they recorded and what they accepted being part
 * of; a place's and an occasion's hold whatever was associated with them.
 *
 * @param view - The view, whose context names the scope.
 * @param bind - Collects the values, so every identifier travels as a parameter.
 * @returns A SQL condition over the alias `m`.
 */
function membership(view: ViewSpecification, bind: PositionalParameters): string {
  const id = bind.bind(view.context.id);

  switch (view.context.type) {
    case "person":
      return `(m.author_user_id = ${id}
               OR EXISTS (SELECT 1 FROM moment_participations part
                           WHERE part.moment_id = m.moment_id
                             AND part.user_id = ${id}
                             AND part.status = 'accepted'))`;

    case "location":
      return `EXISTS (SELECT 1 FROM moment_locations ml
                       WHERE ml.moment_id = m.moment_id
                         AND ml.location_id = ${id})`;

    case "real_world_event":
      return `EXISTS (SELECT 1 FROM moment_real_world_events mre
                       WHERE mre.moment_id = m.moment_id
                         AND mre.real_world_event_id = ${id})`;
  }
}

/**
 * What the view narrows by, beyond belonging to the scope at all.
 *
 * The same lens and filters the projection applies, expressed against the
 * authoritative tables. Narrowing only ever removes: it cannot admit a Moment
 * the visibility rule withheld, because it is joined to that rule with `AND`.
 *
 * @param view - The view, carrying its perspective and filters.
 * @param bind - Collects the values.
 * @returns Conditions, each already prefixed with `AND`, or an empty string.
 */
function narrowing(view: ViewSpecification, bind: PositionalParameters): string {
  const conditions: string[] = [];

  // Only a person's Timeline has a lens: authorship is the whole difference
  // between what somebody recorded and what they agreed to be part of.
  if (view.context.type === "person" && view.perspective !== "all") {
    const person = bind.bind(view.context.id);

    conditions.push(
      view.perspective === "authored"
        ? `m.author_user_id = ${person}`
        : `m.author_user_id <> ${person}`,
    );
  }

  if (view.filters.authorUserId !== undefined) {
    conditions.push(`m.author_user_id = ${bind.bind(view.filters.authorUserId)}`);
  }

  if (view.filters.locationId !== undefined) {
    conditions.push(`EXISTS (SELECT 1 FROM moment_locations filtered
                              WHERE filtered.moment_id = m.moment_id
                                AND filtered.location_id = ${bind.bind(view.filters.locationId)})`);
  }

  if (view.filters.realWorldEventId !== undefined) {
    conditions.push(`EXISTS (SELECT 1 FROM moment_real_world_events filtered
                              WHERE filtered.moment_id = m.moment_id
                                AND filtered.real_world_event_id = ${bind.bind(view.filters.realWorldEventId)})`);
  }

  return conditions.map((condition) => `AND ${condition}`).join("\n            ");
}
