import pg from "pg";
import type { DatabaseConfig } from "../../config/database-config.js";
import type { HealthCheckable } from "../health.js";

/**
 * The API's PostgreSQL infrastructure boundary.
 *
 * Pool construction lives here so feature code never builds its own
 * connections. Table ownership and query implementations belong to features.
 */
export interface Database extends HealthCheckable {
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(config: DatabaseConfig): Database {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    // Bounded so a failing dependency surfaces as an error rather than as a
    // request that hangs until something upstream gives up.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
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
