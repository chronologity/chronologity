import { defineConfig } from "vitest/config";

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
export default defineConfig({
  test: {
    setupFiles: ["./src/testing/setup.ts"],
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
  },
});
