import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ValidationError } from "../errors/validation-error.js";
import { categoryStream, parseStreamName, streamName } from "./stream-name.js";

const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("streamName", () => {
  it("builds a category-prefixed name", () => {
    assert.equal(streamName("moment", uuid), `moment-${uuid}`);
  });

  it("rejects a category containing a hyphen", () => {
    // The first hyphen is the category separator, so a hyphenated category
    // would silently split into something else.
    assert.throws(() => streamName("real-world-event", uuid), ValidationError);
  });

  it("rejects categories that are not lowercase", () => {
    assert.throws(() => streamName("Moment", uuid), ValidationError);
  });

  it("rejects an identifier that could break the naming scheme", () => {
    assert.throws(() => streamName("moment", "id with spaces"), ValidationError);
    assert.throws(() => streamName("moment", "id/with/slashes"), ValidationError);
    assert.throws(() => streamName("moment", ""), ValidationError);
  });
});

describe("categoryStream", () => {
  it("names the built-in category projection", () => {
    assert.equal(categoryStream("moment"), "$ce-moment");
  });
});

describe("parseStreamName", () => {
  it("splits on the first hyphen only, since identifiers contain hyphens", () => {
    assert.deepEqual(parseStreamName(`moment-${uuid}`), {
      category: "moment",
      aggregateId: uuid,
    });
  });

  it("round-trips", () => {
    const name = streamName("session", uuid);
    const parsed = parseStreamName(name);

    assert.equal(streamName(parsed.category, parsed.aggregateId), name);
  });

  it("rejects malformed names", () => {
    assert.throws(() => parseStreamName("nohyphen"), ValidationError);
    assert.throws(() => parseStreamName("-leading"), ValidationError);
    assert.throws(() => parseStreamName("trailing-"), ValidationError);
  });
});
