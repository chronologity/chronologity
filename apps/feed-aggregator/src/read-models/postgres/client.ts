import pg from "pg";
import type { DatabaseConfig } from "../../config/database-config.js";
import type { HealthCheckable } from "../../server/health.js";

/**
 * The aggregator's PostgreSQL boundary.
 *
 * Narrow by intent. `feed.md:307` allows direct PostgreSQL access only where it
 * is limited and deliberate, and names current Viewer eligibility as the reason;
 * `feed.md:321` forbids ordinary Timeline reads from touching these tables at
 * all. So this connection exists to answer one question — does the Session this
 * token names still authenticate — because the answer changes the moment
 * somebody signs out and a token, being a claim made in the past, cannot carry
 * that.
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
    // Small on purpose. Every query through this pool is a lookup by primary
    // key on the path of a request that is otherwise reading ClickHouse; a pool
    // sized for Timeline traffic would be a pool sized for work that does not
    // happen here.
    max: 4,
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
