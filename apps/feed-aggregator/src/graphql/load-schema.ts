import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Read the SDL that defines the read contract.
 *
 * The schema lives in `.graphql` files rather than in strings, so it can be
 * read, diffed and generated from as a schema rather than as source. Resolved
 * relative to this module, which puts it beside the compiled output as well as
 * beside the source — `scripts/copy-schema.mjs` carries the files into `dist`
 * as part of the build, because the compiler will not.
 *
 * Read once at startup and never re-read. A schema that could change while the
 * process runs would be a contract that changes under a client mid-request.
 *
 * Files are concatenated in the order given. GraphQL does not care, and the
 * order is for whoever reads it: the root type first, then the scalars and the
 * paging convention everything else uses, then history from the outside in —
 * a Timeline, a Moment, and the things a Moment is made of.
 *
 * A file not named here is silently absent from the contract, which is why the
 * list is explicit rather than a directory read: a schema file nobody loaded
 * would fail as a missing type at startup rather than as a missing file.
 */
const FILES = [
  "schema.graphql",
  "scalar.graphql",
  "pagination.graphql",
  "timeline.graphql",
  "moment.graphql",
  "media.graphql",
  "location.graphql",
  "user.graphql",
  "reaction.graphql",
  "comment.graphql",
  "causality.graphql",
  "significance.graphql",
] as const;

/**
 * Load the schema.
 *
 * @returns The SDL, as one document.
 * @throws {Error} If a schema file is missing, which in a built artefact means
 *   the copy step did not run — the process should stop rather than start with
 *   part of a contract.
 */
export function loadSchema(): string {
  return FILES.map((file) =>
    readFileSync(fileURLToPath(new URL(`./schema/${file}`, import.meta.url)), "utf8"),
  ).join("\n");
}
