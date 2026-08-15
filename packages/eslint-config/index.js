import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Shared Chronologity ESLint rules.
 *
 * This package pins its own `typescript` dependency at the 6.x line because
 * typescript-eslint does not yet support the TypeScript 7 API (peer range
 * `>=4.8.4 <6.1.0`; TS 7 support is tracked in typescript-eslint#10940).
 * pnpm's isolated store keeps that copy local to the linter, so the root and
 * every application still compile with the TypeScript 7 pinned in the root
 * manifest. TS 7 is a native port of the 6.x compiler rather than a language
 * expansion, so the two agree on syntax today.
 *
 * Collapse this back to a single TypeScript version once typescript-eslint
 * supports 7.x.
 *
 * Runtime-specific presets (Node, React Native, Gatsby) are added here when a
 * real consumer exists rather than in advance of one.
 */

/** Paths no Chronologity package should ever lint. */
export const ignores = [
  "**/node_modules/**",
  "**/.turbo/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.expo/**",
  "**/.cache/**",
  "**/public/**",
];

/** Plain JavaScript, including repository-level configuration files. */
export const javascript = {
  files: ["**/*.{js,mjs,cjs}"],
  extends: [js.configs.recommended],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: {
      ...globals.node,
    },
  },
};

/** TypeScript sources. Type-aware rules are added per package, where a tsconfig is available. */
export const typescript = {
  files: ["**/*.{ts,mts,cts,tsx}"],
  extends: [js.configs.recommended, tseslint.configs.recommended],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  rules: {
    "@typescript-eslint/consistent-type-imports": [
      "error",
      {
        fixStyle: "inline-type-imports",
        prefer: "type-imports",
      },
    ],
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        args: "all",
        argsIgnorePattern: "^_",
        caughtErrors: "all",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
  },
};

/** The default Chronologity baseline: JavaScript and TypeScript rules together. */
export const base = [javascript, typescript];

export default base;
