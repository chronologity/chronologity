import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { isValidAnalyticsMigrationName } from "./migrations.js";

/**
 * The naming convention, and whether the repository keeps to it.
 *
 * A pure check with an integration test's value: the runner applies migrations
 * in filename order, so a name that sorts unexpectedly applies a change at the
 * wrong moment — and a schema cannot be talked out of that afterwards.
 */

describe("a ClickHouse migration filename", () => {
  it("accepts a timestamped kebab-case name", () => {
    assert.equal(isValidAnalyticsMigrationName("20260902090000-create-timeline-moments"), true);
  });

  it("accepts the name with or without its suffix", () => {
    assert.equal(isValidAnalyticsMigrationName("20260902090000-create-timeline.sql"), true);
  });

  it("accepts digits inside the name", () => {
    assert.equal(isValidAnalyticsMigrationName("20260902090000-timeline-v2"), true);
  });

  it("refuses a name with no timestamp", () => {
    assert.equal(isValidAnalyticsMigrationName("create-timeline-moments"), false);
  });

  it("refuses a timestamp of the wrong width", () => {
    // Thirteen digits sorts among fourteen-digit names unpredictably.
    assert.equal(isValidAnalyticsMigrationName("2026090209000-create-timeline"), false);
    assert.equal(isValidAnalyticsMigrationName("202609020900000-create-timeline"), false);
  });

  it("refuses a sequential prefix", () => {
    // `2-` sorts before `10-`, which is the trap timestamps exist to avoid.
    assert.equal(isValidAnalyticsMigrationName("2-create-timeline"), false);
  });

  it("refuses a name that is not kebab-case", () => {
    assert.equal(isValidAnalyticsMigrationName("20260902090000-createTimeline"), false);
    assert.equal(isValidAnalyticsMigrationName("20260902090000-create_timeline"), false);
  });

  it("refuses a timestamp with no name", () => {
    assert.equal(isValidAnalyticsMigrationName("20260902090000"), false);
    assert.equal(isValidAnalyticsMigrationName("20260902090000-"), false);
  });

  it("agrees with every migration actually in the repository", async () => {
    // The check that matters. The rules above are opinions until something
    // confirms the files on disk satisfy them — and a migration that does not
    // is refused at startup, in every environment at once.
    const directory = fileURLToPath(new URL("../../../migrations/clickhouse/", import.meta.url));
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql"));

    assert.ok(files.length > 0, "no ClickHouse migrations were found to check");

    for (const file of files) {
      assert.equal(isValidAnalyticsMigrationName(file), true, file);
    }
  });
});
