// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../config/app-config.js";
import { INDEX_VERSION } from "../features/search/search-document.js";
import { SearchIndexer } from "../features/search/search.indexer.js";
import { rebuildSearchIndex } from "../features/search/search.rebuild.js";
import { SearchRepository } from "../features/search/search.repository.js";
import { SearchSourceRepository } from "../features/search/search-source.repository.js";
import { connectDatabase, createDatabase } from "../lib/database/postgres.js";

/**
 * Rebuild a Search index version from authoritative state.
 *
 *     pnpm search:rebuild [index-version]
 *
 * With no argument it rebuilds the current version in place, which is how a
 * suspected gap is closed. With a version name it builds that one beside the
 * current one, which is how a new version is cut over: build, compare, point
 * the read path at it, delete the old.
 *
 * Safe to run while the indexer runs, and safe to run twice.
 *
 * @returns Nothing, once the rebuild finishes.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const indexVersion = process.argv[2] ?? INDEX_VERSION;
  const database = createDatabase(config.database);
  await connectDatabase(database);

  const sources = new SearchSourceRepository(database.dataSource);
  const indexer = new SearchIndexer(
    database.dataSource,
    new SearchRepository(database.dataSource),
    sources,
    indexVersion,
  );

  process.stdout.write(`Rebuilding ${indexVersion}\n`);

  const report = await rebuildSearchIndex(indexer, sources, {
    onProgress: (entityType, done) => {
      process.stdout.write(`  ${entityType}: ${done}\n`);
    },
  });

  process.stdout.write(
    `Wrote ${report.written}, removed ${report.removed}, superseded ${report.superseded}\n`,
  );

  await database.close();
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`Search rebuild failed: ${String(error)}\n`);
  }
  process.exit(1);
}
