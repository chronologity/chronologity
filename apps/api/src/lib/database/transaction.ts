import type pg from "pg";

/** A connection inside a transaction. Repository functions take this, not the pool. */
export type Transaction = pg.PoolClient;

/**
 * Run work inside a single transaction.
 *
 * Repositories accept a `Transaction` rather than reaching for the pool, which
 * is what makes the transactional outbox possible: a state change and its
 * outbox record are only atomic if they share this connection.
 *
 * The client is released in every path. A leaked connection does not fail
 * loudly; it exhausts the pool later, somewhere unrelated.
 */
export async function withTransaction<Result>(
  pool: pg.Pool,
  work: (tx: Transaction) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The rollback itself failing means the connection is unusable. Report
      // the original error, which is the one that explains what went wrong.
    }
    throw error;
  } finally {
    client.release();
  }
}
