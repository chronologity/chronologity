import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { isValidMigrationName } from "./migrations.js";

describe("isValidMigrationName", () => {
  it("accepts a timestamped kebab-case name", () => {
    assert.equal(isValidMigrationName("20260815031100-foundation"), true);
    assert.equal(isValidMigrationName("20260815031100-add-user-age-verification"), true);
  });

  it("accepts the name with or without its suffix", () => {
    assert.equal(isValidMigrationName("20260815031100-foundation.sql"), true);
  });

  it("accepts digits inside the name", () => {
    assert.equal(isValidMigrationName("20260815031100-add-s3-uploads"), true);
  });

  it("refuses a name with no timestamp", () => {
    // The whole ordering guarantee rests on the prefix. Without one, a
    // migration sorts by its words.
    assert.equal(isValidMigrationName("add-users"), false);
  });

  it("refuses a timestamp of the wrong width", () => {
    // Fixed width is what makes lexicographic order match chronological order.
    assert.equal(isValidMigrationName("2026081503110-foundation"), false);
    assert.equal(isValidMigrationName("202608150311000-foundation"), false);
  });

  it("refuses a sequential prefix", () => {
    // A counter collides the moment two branches add a migration in parallel.
    assert.equal(isValidMigrationName("001-foundation"), false);
  });

  it("refuses a name that is not kebab-case", () => {
    assert.equal(isValidMigrationName("20260815031100-addUsers"), false);
    assert.equal(isValidMigrationName("20260815031100-add_users"), false);
    assert.equal(isValidMigrationName("20260815031100-Add-Users"), false);
    assert.equal(isValidMigrationName("20260815031100-add users"), false);
  });

  it("refuses a timestamp with no name", () => {
    assert.equal(isValidMigrationName("20260815031100"), false);
    assert.equal(isValidMigrationName("20260815031100-"), false);
  });

  it("refuses stray separators", () => {
    assert.equal(isValidMigrationName("20260815031100--foundation"), false);
    assert.equal(isValidMigrationName("20260815031100-foundation-"), false);
  });

  it("agrees with every migration actually in the repository", async () => {
    const { readdir } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const directory = fileURLToPath(new URL("../../../migrations/", import.meta.url));

    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql"));

    assert.ok(files.length > 0, "no migrations found");
    for (const file of files) {
      assert.equal(isValidMigrationName(file), true, `${file} does not follow the convention`);
    }
  });
});
