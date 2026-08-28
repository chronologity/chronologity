import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { registeredEvent } from "@chronologity/contracts";
import { migrate } from "../database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../database/postgres.js";

/**
 * What this system has actually published, against what it says it publishes.
 *
 * The registry is a declaration, and a declaration can be complete and still be
 * wrong about reality. This is the other direction: every event type the outbox
 * has ever held must be registered. It is empirical rather than exhaustive —
 * it can only see what the suites before it produced — and that is what makes
 * it self-maintaining. An event added without registering it fails here the
 * first time anything publishes one, with no list to keep up to date.
 *
 * One-directional, deliberately. A contract registered ahead of the operation
 * that will raise it is a decision, not a defect, so a registered type with no
 * outbox row is not a failure.
 *
 * Requires `pnpm infra:up`.
 */

describe("everything this system has published", () => {
  let database: Database;

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
  });

  afterAll(async () => {
    await database.close();
  });

  it("is registered, or is a test's own invention", async () => {
    // The outbox suites publish deliberately fictional types to topics of their
    // own, which is the right way to test a publisher and must not be mistaken
    // for an unregistered domain event. They are told apart by their topic:
    // a real boundary is `chronologity.<boundary>.v1` and a test's is
    // `chronologity.<something>test-<run>.v1`.
    const rows: { event_type: string; topic: string }[] = await database.dataSource.query(
      "SELECT DISTINCT event_type, topic FROM outbox_messages",
    );

    const published = rows.filter((row) => !/test-[0-9a-f]{8}\./.test(row.topic));

    for (const row of published) {
      assert.notEqual(
        registeredEvent(row.event_type),
        undefined,
        `${row.event_type} was published to ${row.topic} and is in no registry`,
      );
    }
  });
});
