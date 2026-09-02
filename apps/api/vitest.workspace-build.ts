import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Refusing to run tests against a workspace build that is missing something.
 *
 * The API imports `@chronologity/contracts` and `@chronologity/config` by
 * package name, which resolves to their compiled `dist` rather than to their
 * source. Turbo builds those first — every test task declares `^build` — but
 * only when the task is run through turbo from the repository root, and turbo
 * cannot pass a file argument through, so running one suite while chasing a
 * failure means running the package's own script and bypassing the graph.
 *
 * What that produced was `TypeError: registeredEvent is not a function`: a
 * symbol that exists in source, in a `dist` compiled before it did. The message
 * points at the test, the test points at the code, and the code is correct —
 * which cost a full integration run to work out. This turns it into a sentence
 * saying what to do.
 *
 * The check is which modules exist rather than when they were written.
 * Timestamps looked like the obvious signal and are the wrong one: turbo
 * restores a cache hit without touching mtimes, so a perfectly current `dist`
 * can be older than the source it was built from, and a check on that refuses
 * to run a suite that would have passed. Comparing the two sets of module names
 * has no such failure — it is exactly the question "was this file compiled".
 */

/** The workspace packages the API resolves to compiled output. */
const COMPILED = ["config", "contracts", "timeline-derivation"];

/**
 * Every module in a directory tree, named the way an import would name it.
 *
 * @param root - The directory to walk.
 * @param extension - `.ts` for source, `.js` for output.
 * @returns Paths relative to the root with the extension removed, so the two
 *   trees can be compared directly. Empty when the directory does not exist,
 *   which for `dist` means the package was never built.
 */
function modulesUnder(root: string, extension: string): Set<string> {
  const found = new Set<string>();
  const walk = (directory: string, prefix: string): void => {
    let entries;

    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(`${directory}/${entry.name}`, `${prefix}${entry.name}/`);
        continue;
      }

      // Tests are not compiled, and declarations are not modules.
      if (entry.name.endsWith(`.test${extension}`) || entry.name.endsWith(".d.ts")) {
        continue;
      }

      if (entry.name.endsWith(extension)) {
        found.add(`${prefix}${entry.name.slice(0, -extension.length)}`);
      }
    }
  };

  walk(root, "");

  return found;
}

/**
 * Fail now, with a sentence, rather than later with a missing symbol.
 *
 * @returns Nothing.
 * @throws {Error} If a workspace package the API imports has not been built, or
 *   was built before a module was added to it.
 */
export function assertWorkspacePackagesBuilt(): void {
  for (const name of COMPILED) {
    const root = fileURLToPath(new URL(`../../packages/${name}`, import.meta.url));
    const built = modulesUnder(`${root}/dist`, ".js");

    if (built.size === 0) {
      throw new Error(
        `@chronologity/${name} has not been built. Run \`pnpm build\` from the repository root.`,
      );
    }

    const missing = [...modulesUnder(`${root}/src`, ".ts")].filter((module) => !built.has(module));

    if (missing.length > 0) {
      throw new Error(
        `@chronologity/${name} was built before ${missing.join(", ")} existed, and this test run ` +
          `would use the old one. Run \`pnpm build\` from the repository root.`,
      );
    }
  }
}
