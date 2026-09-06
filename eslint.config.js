import { base, ignores, reactNative } from "@chronologity/eslint-config";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * Root ESLint configuration.
 *
 * Rules live in `@chronologity/eslint-config` so applications and packages
 * share one definition. This file only composes them for the repository root.
 *
 * The React Native rules are scoped rather than global: they describe a runtime
 * only `apps/mobile` has, and a rule the backend cannot violate is noise in the
 * backend's output. Scoping here rather than in a second config file keeps the
 * repository's one-config property, which is what makes "run `eslint .`
 * anywhere" true.
 */
export default defineConfig(globalIgnores(ignores), base, {
  files: ["apps/mobile/**/*.{ts,tsx}"],
  extends: [reactNative],
});
