import { defineConfig } from "vitest/config";

/**
 * Unit tests only.
 *
 * Tests are colocated with the implementations they cover (ADR-062), so the
 * pattern selects by suffix rather than by directory. Integration tests use
 * `.integration.ts` and are never picked up here: a unit run must not require
 * infrastructure, and must stay fast enough to run constantly.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
