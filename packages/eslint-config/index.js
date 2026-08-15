import js from "@eslint/js";
import jsdoc from "eslint-plugin-jsdoc";
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

/**
 * Documentation comments.
 *
 * Every function carries a description, its parameters, what it returns, and
 * what it throws. Types are deliberately absent from the tags: TypeScript
 * already states them, and repeating them creates two sources of truth that
 * drift. `check-param-names` is what stops the tags rotting when a parameter
 * is renamed — without it this convention decays quietly.
 *
 * Destructured fields are not individually required. Documenting each one is
 * often worth doing, but mandating it turns a six-field options object into
 * six lines that mostly restate their own names.
 */
export const documentation = {
  files: ["**/*.{ts,mts,cts,tsx,js,mjs,cjs}"],
  plugins: { jsdoc },
  settings: { jsdoc: { mode: "typescript" } },
  rules: {
    "jsdoc/require-jsdoc": [
      "error",
      {
        require: {
          FunctionDeclaration: true,
          MethodDefinition: true,
          ClassDeclaration: true,
          ArrowFunctionExpression: false,
          FunctionExpression: false,
        },
      },
    ],
    "jsdoc/require-description": "error",
    "jsdoc/require-param": ["error", { checkDestructured: false }],
    "jsdoc/require-param-description": "error",
    "jsdoc/check-param-names": ["error", { checkDestructured: false }],
    "jsdoc/require-returns": "error",
    "jsdoc/require-returns-description": "error",
    "jsdoc/require-throws": "error",
    // TypeScript owns the types; a tag that repeats them can only disagree.
    "jsdoc/no-types": "error",
    "jsdoc/check-tag-names": "error",
    "jsdoc/check-alignment": "error",
    "jsdoc/empty-tags": "error",
  },
};

/**
 * Tests.
 *
 * Exempt from the documentation rules. A test's name is its description, and
 * requiring tags on assertions helpers would add noise to the files where
 * readability matters most.
 */
export const tests = {
  files: ["**/*.test.{ts,tsx}", "**/*.integration.ts"],
  rules: {
    "jsdoc/require-jsdoc": "off",
    "jsdoc/require-param": "off",
    "jsdoc/require-returns": "off",
    "jsdoc/require-throws": "off",
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

/** The default Chronologity baseline: JavaScript, TypeScript, and documentation rules. */
export const base = [javascript, typescript, documentation, tests];

export default base;
