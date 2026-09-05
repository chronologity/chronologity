import type { ClickHouseClient } from "@clickhouse/client";
import type { Pool } from "pg";
import type { ReadStore } from "../read-models/clickhouse/client.js";

/**
 * Counting what a request costs, in both stores.
 *
 * **Growth is what these prove, not magnitude.** A number is a judgement about a
 * machine on a day; a number that stays the same against ten times the history is
 * a claim about shape. So the assertions built on this are almost always "the
 * same as", and the ceilings are generous.
 *
 * Counted by wrapping the clients rather than by reading `pg_stat_statements` or
 * ClickHouse's `system.query_log`: this must count what *this request* caused,
 * not what the server has seen, and a proxy that passes everything through
 * changes no behaviour while it counts.
 *
 * Shared because two suites had already copied the PostgreSQL half between them,
 * and a third copy — for ClickHouse — is the point at which that stops being
 * acceptable. A counter that drifts between suites makes them quietly stop
 * measuring the same thing.
 */

/** How many statements a request caused, per store. */
export interface Cost {
  postgres: number;
  clickhouse: number;
}

/**
 * A fresh count.
 *
 * @returns Both counters at zero.
 */
export function newCost(): Cost {
  return { postgres: 0, clickhouse: 0 };
}

/**
 * A pool that counts what it is asked.
 *
 * A proxy rather than a subclass, so nothing about the real pool's behaviour
 * changes — every statement still goes to PostgreSQL, and the count is a
 * side-effect of passing through.
 *
 * @param pool - The real connection.
 * @param cost - Where to count. Shared across every wrapper in one test, so a
 *   request's whole cost lands in one place.
 * @returns The same pool, counting.
 */
export function countingPool(pool: Pool, cost: Cost): Pool {
  return new Proxy(pool, {
    get(target, property, receiver): unknown {
      if (property !== "query") {
        return Reflect.get(target, property, receiver);
      }

      return (...args: unknown[]): unknown => {
        cost.postgres += 1;

        return (target.query as (...passed: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

/**
 * A ClickHouse boundary that counts what it is asked, and refuses to write.
 *
 * **The refusal is the more valuable half.** `security.md:2063` makes "the feed
 * aggregator cannot mutate ClickHouse" a property of the credential a deployment
 * issues, which no test in this repository can exercise. Throwing from `insert`,
 * `command` and `exec` here turns it into something a suite can prove about the
 * code — if a read path ever grows a write, it fails in the aggregator's own
 * tests rather than in production against a role that refuses it.
 *
 * @param store - The real boundary.
 * @param cost - Where to count.
 * @returns The same store, counting reads and refusing writes.
 */
export function countingStore(store: ReadStore, cost: Cost): ReadStore {
  const client = new Proxy(store.client, {
    get(target, property, receiver): unknown {
      if (property === "query") {
        return (...args: unknown[]): unknown => {
          cost.clickhouse += 1;

          return (target.query as (...passed: unknown[]) => unknown).apply(target, args);
        };
      }

      if (property === "insert" || property === "command" || property === "exec") {
        return (): never => {
          throw new Error(`The feed aggregator called ClickHouse's ${String(property)}; it only reads`);
        };
      }

      return Reflect.get(target, property, receiver);
    },
  }) as ClickHouseClient;

  return { ...store, client, close: () => store.close(), checkHealth: () => store.checkHealth() };
}
