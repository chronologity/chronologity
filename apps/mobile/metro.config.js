// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

/**
 * Metro, taught to resolve this repository's own packages.
 *
 * Expo configures monorepos itself from SDK 52 onwards, so the watch folders
 * and module paths are not repeated here. One thing it does not turn on is the
 * one this application depends on completely.
 *
 * `@chronologity/api-client` and `@chronologity/contracts` are ESM-only and
 * describe themselves with an `exports` map rather than a `main` field. Without
 * package-exports support Metro falls back to guessing, and the failure is not a
 * clear one: it surfaces as a module resolving to nothing, deep inside a bundle,
 * long after the thing that caused it.
 *
 * `expo export` runs in CI, which is what makes this configuration checked
 * rather than merely written.
 */
const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;

module.exports = config;
