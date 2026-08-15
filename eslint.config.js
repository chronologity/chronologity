import { base, ignores } from "@chronologity/eslint-config";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * Root ESLint configuration.
 *
 * Rules live in `@chronologity/eslint-config` so applications and packages
 * share one definition. This file only composes them for the repository root.
 */
export default defineConfig(globalIgnores(ignores), base);
