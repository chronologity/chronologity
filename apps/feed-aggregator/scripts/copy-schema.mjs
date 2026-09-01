import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Carry the SDL into the build.
 *
 * The schema is written as `.graphql` files rather than as strings in
 * TypeScript, which is what `monorepo.md` asks for and what gives the schema
 * editor tooling and, later, code generation. TypeScript does not copy files it
 * cannot compile, so the build has to.
 *
 * Idempotent, and safe to run before a compile has happened: if `dist` is not
 * there yet, there is nothing to put the schema beside.
 */
const source = fileURLToPath(new URL("../src/graphql/schema", import.meta.url));
const destination = fileURLToPath(new URL("../dist/graphql/schema", import.meta.url));

if (!existsSync(fileURLToPath(new URL("../dist", import.meta.url)))) {
  process.stderr.write("No dist directory: run the compiler first.\n");
  process.exit(1);
}

cpSync(source, destination, { recursive: true });
