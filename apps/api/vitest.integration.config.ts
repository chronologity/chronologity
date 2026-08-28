import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { assertWorkspacePackagesBuilt } from "./vitest.workspace-build.js";

/**
 * Integration tests, against real infrastructure.
 *
 * Requires `pnpm infra:up`.
 */

// Loaded here rather than left to the shell. These tests read connection
// details from the environment, and a missing `POSTGRES_PORT` does not fail
// loudly — it silently connects to whatever else is listening on 5432, which
// has already cost one debugging session. Turbo's strict env filtering cannot
// hide a file the config reads itself.
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// Before anything is collected. A stale `dist` fails as a missing symbol
// several minutes into a run, which reads as a defect in whatever test
// happened to touch it first.
assertWorkspacePackagesBuilt();

export default defineConfig({
  test: {
    setupFiles: ["./src/testing/setup.ts"],
    include: ["src/**/*.integration.test.ts"],
    // Real infrastructure is slow in ways unit tests are not: Argon2id
    // hashing, waiting on delivered mail, and projections catching up.
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // One file at a time. These suites share a database, an event store, and
    // global checkpoint tables; running them concurrently would make every
    // failure a question about which suite interfered with which.
    fileParallelism: false,
  },
});
