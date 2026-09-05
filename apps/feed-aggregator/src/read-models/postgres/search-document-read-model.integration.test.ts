import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { testAppConfig } from "../../testing/app-config.js";
import { indexDocument } from "../../testing/moment-fixtures.js";
import { createDirectory, type Directory } from "./client.js";
import { SearchDocumentReadModel } from "./search-document-read-model.js";

/**
 * Whether a thing is still findable.
 *
 * An integration test rather than a unit one, because what is being proved is a
 * predicate PostgreSQL evaluates. Unit-testing it would mean stubbing the
 * statement and asserting the stub, which proves only that the test agrees with
 * itself.
 *
 * Almost every case here is a *false*, and that is the shape of the thing:
 * findability is one way to be true and several ways to stop being, and it is
 * the stopping that has to work.
 *
 * The documents are about identifiers nothing else owns, so they are tracked and
 * removed here rather than by `removePeople` — which cleans up after people, and
 * these belong to nobody.
 */

const config = testAppConfig();

let directory: Directory;
let documents: SearchDocumentReadModel;
const indexed: string[] = [];

/**
 * An identifier with a document about it, remembered for cleanup.
 *
 * @param entityType - What kind of thing.
 * @param over - Anything the document needs different.
 * @returns The identifier.
 */
async function documented(
  entityType: "moment" | "user" | "event" | "location",
  over: { indexVersion?: string; searchable?: boolean; deleted?: boolean } = {},
): Promise<string> {
  const entityId = randomUUID();

  await indexDocument(directory.pool, entityType, entityId, over);
  indexed.push(entityId);

  return entityId;
}

beforeAll(async () => {
  directory = createDirectory(config.database);

  const present = await directory.pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.search_documents') IS NOT NULL AS exists",
  );

  if (present.rows[0]?.exists !== true) {
    throw new Error("The schema is missing. The API owns it: run `pnpm db:migrate` and try again.");
  }

  documents = new SearchDocumentReadModel(directory.pool, "search-v1");
});

afterAll(async () => {
  await directory.pool.query("DELETE FROM search_documents WHERE entity_id = ANY($1)", [indexed]);
  await directory.close();
});

describe("whether a thing is still findable", () => {
  it("finds a live document", async () => {
    const entityId = await documented("user");

    assert.equal(await documents.findable("user", entityId), true);
  });

  it("does not find a thing nothing ever indexed", async () => {
    assert.equal(await documents.findable("moment", randomUUID()), false);
  });

  it("does not find a thing withdrawn from indexing", async () => {
    // Kept visible, taken out of Search. The product treats those as separate
    // states deliberately, and this is the one a plain visibility check cannot
    // see. It is also unsearchable for *everybody*, its author included — which
    // is the assumption the anchor rests on, since this read takes no Viewer and
    // would be wrong if the answer varied by one.
    const entityId = await documented("moment", { searchable: false });

    assert.equal(await documents.findable("moment", entityId), false);
  });

  it("does not find an erased thing", async () => {
    const entityId = await documented("location", { deleted: true });

    assert.equal(await documents.findable("location", entityId), false);
  });

  it("does not find a document belonging to another index version", async () => {
    // What a rebuild looks like from here: v2 documents exist and are correct,
    // and this process is not serving them. Answering from whichever version
    // happened to have a row would answer about an index nobody reads.
    const entityId = await documented("event", { indexVersion: "search-v2" });

    assert.equal(await documents.findable("event", entityId), false);
  });

  it("does not confuse one kind of thing with another sharing an identifier", async () => {
    // The key is the pair, not the identifier alone. Nothing stops a Moment and
    // a place carrying the same one, and answering about the wrong kind would be
    // answering about the wrong thing.
    const entityId = await documented("moment");

    assert.equal(await documents.findable("moment", entityId), true);
    assert.equal(await documents.findable("location", entityId), false);
  });

  it("asks the version it was built for, not whichever one has a row", async () => {
    // The same identifier documented twice, findable under one version and not
    // the other. A read model that ignored the version would answer true for
    // both and would keep answering true after a cutover it was not told about.
    const entityId = await documented("user", { indexVersion: "search-v2" });

    await indexDocument(directory.pool, "user", entityId, { searchable: false });

    assert.equal(await documents.findable("user", entityId), false);
    assert.equal(
      await new SearchDocumentReadModel(directory.pool, "search-v2").findable("user", entityId),
      true,
    );
  });
});
