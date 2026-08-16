import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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

export default defineConfig({
  test: {
    include: ["src/**/*.integration.ts"],
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
