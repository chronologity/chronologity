import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { interpretResults } from "./place-search-client.js";

/**
 * Reading what the map service actually returns.
 *
 * The fixtures are real responses, captured once from OpenStreetMap. That
 * matters: a stand-in written from what I assumed the service returns would
 * test my assumptions. The real ones settled several details — that the field
 * a place is named by can be absent, that the durable reference is a type and
 * identifier pair rather than the `place_id` sitting next to it, and which of
 * city, town or village a place is filed under depending on its size.
 */

const recorded = (name: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}.json`, import.meta.url)), "utf8"),
  );

describe("interpreting a real response", () => {
  it("reads a venue", () => {
    const [place] = interpretResults(recorded("madison-square-garden"));

    assert.ok(place !== undefined);
    assert.equal(place.name, "Madison Square Garden");
    assert.ok(Math.abs(place.coordinates.latitude - 40.7505) < 0.01);
    assert.ok(Math.abs(place.coordinates.longitude - -73.9935) < 0.01);
  });

  it("uses the durable reference rather than the row number beside it", () => {
    // The response also carries `place_id`, an internal row number that
    // changes whenever the data is reimported. Using it would leave our
    // provenance pointing at nothing after the next import.
    const [place] = interpretResults(recorded("madison-square-garden"));

    assert.match(place?.reference ?? "", /^(node|way|relation):\d+$/);
    assert.doesNotMatch(place?.reference ?? "", /^\d+$/);
  });

  it("reads the wider areas a place sits inside", () => {
    const [place] = interpretResults(recorded("madison-square-garden"));

    assert.equal(place?.context.city, "New York");
    assert.equal(place?.context.region, "New York");
    assert.equal(place?.context.country, "United States");
    assert.equal(place?.context.countryCode, "US");
  });

  it("keeps the full description, for telling similar places apart", () => {
    const [place] = interpretResults(recorded("madison-square-garden"));

    assert.ok((place?.description.length ?? 0) > (place?.name.length ?? 0));
    assert.match(place?.description ?? "", /New York/);
  });

  it("reads a city as readily as a venue", () => {
    const [place] = interpretResults(recorded("reykjavik"));

    assert.ok(place !== undefined);
    assert.ok(place.name.length > 0);
    assert.equal(place.context.countryCode, "IS");
  });

  it("returns nothing for a search that matched nothing", () => {
    assert.deepEqual(interpretResults(recorded("no-results")), []);
  });

  it("survives a response that is not a list", () => {
    // The service answers errors as an object rather than an array. Throwing
    // here would turn a bad search into a crash.
    for (const nonsense of [{}, null, undefined, "an error", 42]) {
      assert.deepEqual(interpretResults(nonsense), [], String(nonsense));
    }
  });

  it("drops a result missing what a place needs, keeping the rest", () => {
    const usable = {
      osm_type: "way",
      osm_id: 1,
      name: "Somewhere",
      lat: "1",
      lon: "2",
      display_name: "Somewhere",
    };

    const results = interpretResults([
      { name: "No reference", lat: "1", lon: "2" },
      { osm_type: "way", osm_id: 2, name: "No position" },
      usable,
    ]);

    assert.equal(results.length, 1);
    assert.equal(results[0]?.name, "Somewhere");
  });

  it("falls back to the full description when a place has no short name", () => {
    const results = interpretResults([
      {
        osm_type: "node",
        osm_id: 9,
        display_name: "A road, A town, A country",
        lat: "1",
        lon: "2",
      },
    ]);

    assert.equal(results[0]?.name, "A road, A town, A country");
  });

  it("files a place under whichever of city, town or village it has", () => {
    const town = interpretResults([
      { osm_type: "node", osm_id: 1, name: "P", lat: "1", lon: "2", address: { town: "Ambridge" } },
    ]);
    const village = interpretResults([
      {
        osm_type: "node",
        osm_id: 2,
        name: "P",
        lat: "1",
        lon: "2",
        address: { village: "Darrowby" },
      },
    ]);

    assert.equal(town[0]?.context.city, "Ambridge");
    assert.equal(village[0]?.context.city, "Darrowby");
  });
});
