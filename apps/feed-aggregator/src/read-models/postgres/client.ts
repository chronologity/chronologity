import pg from "pg";
import type { DatabaseConfig } from "../../config/database-config.js";
import type { HealthCheckable } from "../../server/health.js";

/**
 * The aggregator's PostgreSQL boundary.
 *
 * Narrow by intent. `feed.md:307` allows direct PostgreSQL access only where it
 * is limited and deliberate, and names current Viewer eligibility as the reason;
 * `feed.md:321` forbids ordinary Timeline reads from touching these tables at
 * all. So this connection answers two questions and no others.
 *
 * Does the Session this token names still authenticate — because the answer
 * changes the moment somebody signs out, and a token, being a claim made in the
 * past, cannot carry that. And what may this Viewer see: Blocks, the Moments
 * naming them within a scope, whether they are old enough, and whether the
 * person whose history they asked for has closed it. Those four facts change
 * while a projection lags, which is why `feed.md:459` requires them from
 * current state rather than from the rows being filtered.
 *
 * `pg` rather than the API's TypeORM, and that is the point rather than an
 * economy. An ORM here would mean entity classes for tables this application
 * must never write, and a class that can be saved is one somebody can save.
 * A pool and a parameterised query cannot be talked into a write.
 *
 * The credential should be read-only. Nothing here is entitled to change
 * anything, and `data-storage.md:436` says the aggregator must hold no
 * schema-admin or mutation permission on any authoritative store.
 */
export interface Directory extends HealthCheckable {
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * Build the PostgreSQL boundary.
 *
 * @param config - Where the server is, and which database and credentials to
 *   use.
 * @returns The pool, a health check that performs a real query, and a close.
 *   Returned unconnected: `pg` opens a connection on first use, so this can be
 *   built without a server present, and a configuration error surfaces before
 *   any I/O.
 */
export function createDirectory(config: DatabaseConfig): Directory {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    // Sized for what a single request actually holds. Eligibility issues three
    // statements at once per scope, so one request can occupy three connections
    // and a pool of four would have two concurrent readers waiting on each
    // other. Still far short of a pool sized for Timeline traffic, which is not
    // what happens here — history is read from ClickHouse.
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  return {
    name: "postgres",
    pool,
    async checkHealth() {
      await pool.query("SELECT 1");
    },
    async close() {
      await pool.end();
    },
  };
}
