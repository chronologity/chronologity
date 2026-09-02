import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { migrate } from "./migrations.js";
import { connectDatabase, createDatabase, type Database } from "./postgres.js";

/**
 * Do the entities still describe the database?
 *
 * The migrations own the schema and the entities only describe it (ADR-099),
 * which means nothing stops the two drifting: add a column in a migration and
 * forget the entity, or rename a property and leave the `name` behind, and the
 * mistake surfaces as a puzzling runtime error in whichever feature touches
 * that column first.
 *
 * `synchronize` cannot be used to check this. It would report every partial
 * index and check constraint the entities deliberately cannot express, so the
 * answer would always be "different" and would mean nothing.
 *
 * So this asks the narrower question the entities can actually answer: does
 * every column an entity claims exist, with the nullability it claims, and does
 * every column in those tables have somewhere to land.
 *
 * Requires `pnpm infra:up`.
 */

interface InformationSchemaColumn {
  table_name: string;
  column_name: string;
  is_nullable: "YES" | "NO";
}

describe("entities against the migrated schema", () => {
  let database: Database;
  let columns: InformationSchemaColumn[];

  beforeAll(async () => {
    database = createDatabase({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      database: process.env.POSTGRES_DATABASE ?? "chronologity",
      user: process.env.POSTGRES_USER ?? "chronologity",
      password: process.env.POSTGRES_PASSWORD ?? "chronologity",
    });
    await connectDatabase(database);
    await migrate(database.dataSource);

    columns = await database.dataSource.query(
      `SELECT table_name, column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'`,
    );
  });

  afterAll(async () => {
    await database.close();
  });

  /** Every column the database actually has, by table. */
  const actual = (table: string): Map<string, boolean> =>
    new Map(
      columns
        .filter((column) => column.table_name === table)
        .map((column) => [column.column_name, column.is_nullable === "YES"]),
    );

  it("declares no column the database does not have", () => {
    const missing: string[] = [];

    for (const entity of database.dataSource.entityMetadatas) {
      const present = actual(entity.tableName);

      for (const column of entity.columns) {
        if (!present.has(column.databaseName)) {
          missing.push(`${entity.tableName}.${column.databaseName} (${entity.name})`);
        }
      }
    }

    assert.deepEqual(missing, [], "entities name columns that do not exist");
  });

  it("agrees with the database about what may be null", () => {
    const disagreements: string[] = [];

    for (const entity of database.dataSource.entityMetadatas) {
      const present = actual(entity.tableName);

      for (const column of entity.columns) {
        const nullable = present.get(column.databaseName);

        if (nullable !== undefined && nullable !== column.isNullable) {
          disagreements.push(
            `${entity.tableName}.${column.databaseName}: entity says ` +
              `${column.isNullable ? "nullable" : "not null"}, database says ` +
              `${nullable ? "nullable" : "not null"}`,
          );
        }
      }
    }

    // A column the entity thinks is required but the database allows to be null
    // hands `null` to code whose type says it cannot be. The reverse fails on
    // insert instead, which is louder but no more correct.
    assert.deepEqual(disagreements, [], "entities disagree with the database about nullability");
  });

  it("has an entity for every table the migrations create", () => {
    const claimed = new Set(
      database.dataSource.entityMetadatas.map((entity) => entity.tableName),
    );
    const unclaimed = [...new Set(columns.map((column) => column.table_name))]
      .filter((table) => !claimed.has(table))
      .sort();

    // The direction the other two cannot see: a table nothing maps is not
    // compared against anything, so a whole feature's schema could drift
    // unnoticed. If a table ever legitimately has no entity, this failing is
    // the prompt to say so deliberately rather than to discover it later.
    assert.deepEqual(unclaimed, [], "the database has tables no entity maps");
  });

  it("maps every column of every table it claims", () => {
    const unmapped: string[] = [];

    for (const entity of database.dataSource.entityMetadatas) {
      const mapped = new Set(entity.columns.map((column) => column.databaseName));

      for (const name of actual(entity.tableName).keys()) {
        if (!mapped.has(name)) {
          unmapped.push(`${entity.tableName}.${name}`);
        }
      }
    }

    // The direction that catches a migration nobody reflected back: the column
    // is there, the entity has never heard of it, and every read silently omits
    // it.
    assert.deepEqual(unmapped, [], "the database has columns no entity maps");
  });
});
