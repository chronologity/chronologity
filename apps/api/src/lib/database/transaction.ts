import type { DataSource, EntityManager } from "typeorm";

/**
 * A transaction, as everything below a service sees it.
 *
 * TypeORM's `EntityManager` bound to one connection inside a transaction.
 * Repositories take this rather than the DataSource, so a repository cannot
 * write outside the transaction its caller opened.
 */
export type Transaction = EntityManager;

/**
 * Run work inside a single transaction.
 *
 * Repositories accept a `Transaction` rather than reaching for the DataSource,
 * which is what makes the transactional outbox possible: a state change and the
 * outbox message announcing it are only atomic if they share this transaction
 * (ADR-093).
 *
 * The connection is returned in every path, including the failing one. A leaked
 * connection does not fail loudly; it exhausts the pool later, somewhere
 * unrelated.
 *
 * @param dataSource - The DataSource to open a transaction on.
 * @param work - Runs inside the transaction and receives its manager.
 * @returns Whatever the work returns, once committed.
 * @throws Whatever the work throws, after rolling back. A refusal raised inside
 *   the work is therefore a rollback as well as an error, which is what lets a
 *   service reject something halfway through without leaving the first half
 *   behind.
 */
export async function withTransaction<Result>(
  dataSource: DataSource,
  work: (tx: Transaction) => Promise<Result>,
): Promise<Result> {
  return dataSource.transaction((manager) => work(manager));
}
