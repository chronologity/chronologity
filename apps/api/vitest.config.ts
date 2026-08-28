import { defineConfig } from "vitest/config";
import { assertWorkspacePackagesBuilt } from "./vitest.workspace-build.js";

/**
 * Unit tests only.
 *
 * Tests are colocated with the implementations they cover (ADR-062), so the
 * pattern selects by suffix rather than by directory. Integration tests end in
 * `.integration.test.ts` and are excluded rather than simply unmatched: they
 * are `.test.ts` files too, which is the point of the name, so the unit run
 * has to say it does not want them. A unit run must never require
 * infrastructure.
 */
// Before anything is collected. A stale `dist` fails as a missing symbol
// several minutes into a run, which reads as a defect in whatever test
// happened to touch it first.
assertWorkspacePackagesBuilt();

export default defineConfig({
  test: {
    setupFiles: ["./src/testing/setup.ts"],
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
  },
});
