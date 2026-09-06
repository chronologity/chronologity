import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { contractRegistry } from "./registry.js";
import { errorResponseSchema } from "./errors.js";
import { momentSchema } from "./moments.js";

/**
 * The public names for wire shapes.
 *
 * An id here is not an implementation detail: it becomes a key in the published
 * document's `components.schemas`, so anything reading that document or
 * generating from it uses these words. Changing one changes the published
 * contract.
 */

describe("naming the shapes that cross the boundary", () => {
  it("gives every registered schema exactly one name", async () => {
    const ids = [...contractRegistry._idmap.keys()];

    assert.deepEqual(
      ids.filter((id, index) => ids.indexOf(id) !== index),
      [],
      "two shapes share a name, so one would silently overwrite the other",
    );
  });

  it("names the shapes that repeat most", async () => {
    // These are the ones the inlined document wrote out dozens of times each.
    assert.equal(contractRegistry.get(momentSchema)?.id, "Moment");
    assert.equal(contractRegistry.get(errorResponseSchema)?.id, "ErrorResponse");
  });

  it("uses names a reader would recognise, not schema variable names", async () => {
    // `momentSchema` is how this codebase spells it; `Moment` is what the
    // contract is about. The document is read by people who have never seen
    // this repository.
    const ids = [...contractRegistry._idmap.keys()];

    assert.deepEqual(
      ids.filter((id) => id.endsWith("Schema") || /^[a-z]/.test(id)),
      [],
    );
  });

  it("names enough to be worth doing", async () => {
    // A registry with a handful of entries would leave the document mostly
    // inlined and the diff argument mostly unfixed.
    assert.ok(contractRegistry._idmap.size >= 60, `only ${contractRegistry._idmap.size} named`);
  });
});
