/**
 * Where the Timeline read models live.
 *
 * Separate from `DatabaseConfig` because the two stores answer different
 * questions and are allowed to move apart: ClickHouse holds nothing
 * authoritative, so it may be replaced, rebuilt or relocated without the
 * relational configuration changing.
 */
export interface ClickHouseConfig {
  /** The HTTP endpoint, including scheme and port. */
  readonly url: string;
  readonly database: string;
  readonly username: string;
  readonly password: string;
}
