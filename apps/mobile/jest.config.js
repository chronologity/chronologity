/**
 * Tests, on the runner React Native supports.
 *
 * The rest of this repository runs Vitest, and ADR-076 said so while carving
 * out exactly this: its decision "covers the TypeScript backend and shared
 * packages, not the whole repository", because `jest-expo` is what the Expo
 * toolchain expects. The preset is the reason — it mocks the native half of
 * every Expo module, which nothing else does and which no amount of
 * configuration replaces.
 *
 * `transformIgnorePatterns` is the line that matters, and it is written the way
 * it is because of pnpm. Metro compiles the React Native ecosystem's
 * untranspiled ESM; Jest does not, unless told which packages to put through
 * Babel. Every published example of that list assumes npm's flat layout and
 * matches on `node_modules/<name>`, which under pnpm is really
 * `node_modules/.pnpm/<name>@<version>_<hash>/node_modules/<name>` — so the
 * usual pattern matches nothing and the first React Native import fails.
 *
 * Matching the name anywhere in the path works under either layout. It also
 * covers this repository's own packages, which are ESM as well.
 */
module.exports = {
  preset: "jest-expo",
  transformIgnorePatterns: [
    "node_modules/(?!.*(react-native|@react-native|expo|@expo|@react-navigation|@testing-library|@chronologity|@unimodules|unimodules))",
  ],
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
};
