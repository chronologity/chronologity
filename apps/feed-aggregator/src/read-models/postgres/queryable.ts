import type pg from "pg";
import type { Queryable } from "@chronologity/timeline-derivation";

/**
 * Let the shared eligibility rule run through this application's pool.
 *
 * `packages/timeline-derivation` asks for the narrowest thing it needs —
 * something with `query(sql, params)` returning rows — so that it depends on no
 * particular client. TypeORM's `DataSource` satisfies that shape as it stands,
 * which is why the API needed no adapter. `pg` answers with `{ rows }` instead,
 * so this unwraps it.
 *
 * Four lines, and worth naming rather than inlining: the aggregator is the
 * first caller to run the resolver's statements through `pg` at all, and if
 * something about that turns out to differ, this is the seam it differs at.
 *
 * @param pool - The read-only pool this application already holds.
 * @returns The pool as the shared package expects to receive it.
 */
export function asQueryable(pool: pg.Pool): Queryable {
  return {
    async query<Row>(sql: string, parameters?: readonly unknown[]): Promise<Row[]> {
      // Copied because `pg` types parameters as a mutable array, where the
      // shared interface promises not to modify them — stricter rather than
      // incompatible, and a copy is the honest way to satisfy both.
      const result = await pool.query(sql, parameters === undefined ? undefined : [...parameters]);

      return result.rows as Row[];
    },
  };
}
