/**
 * How a caller's client spells a bound value.
 *
 * The rules in this package are SQL text with holes in them, and the two
 * applications that read a Moment punch those holes differently: the API builds
 * queries through TypeORM, which binds by name (`:viewerUserId`), and the feed
 * aggregator sends statements through `pg`, which binds by position (`$1`).
 *
 * So the package emits **no placeholder syntax of its own**. A caller supplies
 * the tokens, the rule interpolates them, and neither dialect is privileged.
 *
 * The alternative was a dialect flag inside these functions, and it does not
 * work: positional numbering depends on how many values the surrounding
 * statement has already bound, which this package cannot see and must not be
 * told. Rewriting one dialect into the other with a regular expression is worse
 * — a rewriter over SQL is a parser, and this is the one string it must never
 * mis-parse.
 */

/** The two facts every Moment rule reads about whoever is asking. */
export interface ViewerPlaceholders {
  readonly viewerUserId: string;
  readonly viewerIsAdult: string;
}

/**
 * TypeORM's dialect, stated once.
 *
 * Here rather than at each call site, so that the names the query builder binds
 * and the names the rule reads cannot drift apart in a way that fails as an
 * empty result rather than as an error.
 */
export const NAMED_VIEWER: ViewerPlaceholders = {
  viewerUserId: ":viewerUserId",
  viewerIsAdult: ":viewerIsAdult",
};

/**
 * Positional binding, for a client that numbers its parameters.
 *
 * A binder rather than a starting index, and the difference is worth the class.
 * An index is one off-by-one away from sending a Moment identifier where the
 * rule expects the Viewer — and that mistake does not raise, it returns nothing,
 * which reads exactly like a Moment that was withheld.
 *
 * Collecting the values here means the token and the value it stands for are
 * produced by the same call, so they cannot be listed in different orders.
 */
export class PositionalParameters {
  private readonly collected: unknown[] = [];

  /**
   * Bind a value and get the token that reads it back.
   *
   * @param value - What the statement should send.
   * @returns Its placeholder, `$1` upwards in the order bound.
   */
  bind(value: unknown): string {
    this.collected.push(value);

    return `$${this.collected.length}`;
  }

  /**
   * Everything bound so far.
   *
   * @returns The values, in the order their tokens were issued. Copied, so a
   *   caller holding the array cannot alter what a later `bind` numbers.
   */
  get values(): readonly unknown[] {
    return [...this.collected];
  }
}
