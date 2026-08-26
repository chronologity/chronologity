import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { geohash } from "./search-document.js";
import { cellsAround, coverageFor, decode, TIER_LENGTH } from "./search.geo.js";

describe("coverageFor", () => {
  it("answers a street-sized radius with the finest cells", () => {
    assert.equal(coverageFor(150).tier, "exact");
  });

  it("answers a town-sized radius with neighbourhood cells", () => {
    assert.equal(coverageFor(5_000).tier, "neighbourhood");
  });

  it("answers a country-sized radius with region cells", () => {
    assert.equal(coverageFor(500_000).tier, "region");
  });

  it("covers the radius it was asked for at every size", () => {
    // The invariant that replaced an earlier one. The first version asked that
    // cells never be wider than the radius, which is the wrong way round: what
    // matters is that everything within the radius is looked at. Cells wider
    // than the radius return a little too much, which is the right way to be
    // wrong — the alternative loses history without saying so.
    const reach = { exact: 19, neighbourhood: 4_890, region: 156_000 } as const;

    for (const radius of [50, 100, 1_000, 4_889, 4_890, 100_000, 155_999, 156_000, 1_000_000]) {
      const coverage = coverageFor(radius);

      assert.ok(
        coverage.rings * reach[coverage.tier] >= radius,
        `${radius} covered only ${coverage.rings * reach[coverage.tier]}`,
      );
    }
  });

  it("gives the finest cells for a radius smaller than any cell", () => {
    // The smallest honest answer rather than a refusal.
    assert.equal(coverageFor(1).tier, "exact");
    assert.equal(coverageFor(0).tier, "exact");
  });

  it("gives the coarsest cells for a radius larger than any", () => {
    assert.equal(coverageFor(20_000_000).tier, "region");
  });

  it("never widens as the radius shrinks", () => {
    const rank = { exact: 0, neighbourhood: 1, region: 2 };
    let previous = 2;

    for (const radius of [1_000_000, 200_000, 10_000, 5_000, 1_000, 100, 1]) {
      const current = rank[coverageFor(radius).tier];

      assert.ok(current <= previous, `${radius}`);
      previous = current;
    }
  });
});

describe("decode", () => {
  it("returns a box containing the position it was encoded from", () => {
    const box = decode(geohash(38.7223, -9.1393, 8));

    assert.ok(box.latMin <= 38.7223 && 38.7223 <= box.latMax);
    assert.ok(box.lonMin <= -9.1393 && -9.1393 <= box.lonMax);
  });

  it("returns a smaller box for a longer hash", () => {
    const coarse = decode(geohash(38.7223, -9.1393, 3));
    const fine = decode(geohash(38.7223, -9.1393, 8));

    assert.ok(fine.latMax - fine.latMin < coarse.latMax - coarse.latMin);
  });

  it("decodes the canonical reference hash to a box around its point", () => {
    const box = decode("u4pruydqqvj");

    assert.ok(box.latMin <= 57.64911 && 57.64911 <= box.latMax);
    assert.ok(box.lonMin <= 10.40744 && 10.40744 <= box.lonMax);
  });

  it("refuses something that is not a geohash", () => {
    assert.throws(() => decode("not-a-hash"));
  });
});

describe("cellsAround", () => {
  it("names the containing cell and the eight around it", () => {
    const cells = cellsAround(38.7223, -9.1393, "neighbourhood", geohash);

    assert.equal(cells.length, 9);
    assert.ok(cells.includes(geohash(38.7223, -9.1393, TIER_LENGTH.neighbourhood)));
  });

  it("finds a position just across a cell boundary", () => {
    // The whole reason neighbours are computed. A prefix match on the centre
    // cell alone misses a place a few metres away on the other side of an edge.
    const box = decode(geohash(38.7223, -9.1393, TIER_LENGTH.neighbourhood));
    const justOver = box.lonMin - 0.0001;
    const neighbourCell = geohash(38.7223, justOver, TIER_LENGTH.neighbourhood);

    assert.notEqual(neighbourCell, geohash(38.7223, -9.1393, TIER_LENGTH.neighbourhood));
    assert.ok(cellsAround(38.7223, -9.1393, "neighbourhood", geohash).includes(neighbourCell));
  });

  it("names distinct cells", () => {
    const cells = cellsAround(51.5074, -0.1278, "exact", geohash);

    assert.equal(new Set(cells).size, cells.length);
  });

  it("wraps at the antimeridian rather than looking only one way", () => {
    const cells = cellsAround(0, 179.9999, "region", geohash);
    const westward = geohash(0, -179.9, TIER_LENGTH.region);

    // A search off Fiji has neighbours on both sides of the date line.
    assert.ok(cells.includes(westward), cells.join(","));
  });

  it("never names a cell far from the point, including at the poles", () => {
    // The property that matters: a step past the top of the world must not
    // continue over it and name somewhere on the far side of the planet.
    //
    // No single line can currently be removed to make this fail — the encoding
    // saturates at the poles by construction. It is here to hold that property
    // if the encoder is ever rewritten to use modular arithmetic, where
    // stepping past a pole would wrap rather than stop.
    for (const [latitude, longitude] of [
      [89.999, 0],
      [-89.999, 0],
      [0, 179.999],
      [51.5074, -0.1278],
    ] as const) {
      for (const cell of cellsAround(latitude, longitude, "region", geohash)) {
        const box = decode(cell);
        const centre = (box.latMin + box.latMax) / 2;

        assert.ok(
          Math.abs(centre - latitude) < 10,
          `${cell} at latitude ${centre} is nowhere near ${latitude}`,
        );
      }
    }
  });

  it("gives finer tiers smaller steps", () => {
    const coarse = decode(cellsAround(38.7223, -9.1393, "region", geohash)[0]!);
    const fine = decode(cellsAround(38.7223, -9.1393, "exact", geohash)[0]!);

    assert.ok(fine.latMax - fine.latMin < coarse.latMax - coarse.latMin);
  });

  it("reaches further when asked for more rings", () => {
    // One ring reaches one cell in each direction. A radius wider than a cell
    // needs more, and covering it with one ring would silently miss most of
    // what the search claimed to look at.
    assert.equal(cellsAround(38.7223, -9.1393, "exact", geohash, 1).length, 9);
    assert.equal(cellsAround(38.7223, -9.1393, "exact", geohash, 2).length, 25);
    assert.equal(cellsAround(38.7223, -9.1393, "exact", geohash, 3).length, 49);
  });

  it("covers everything within the radius it was asked for", () => {
    const LAT = 12.3456;
    const LON = 98.7654;
    const radius = 100;
    const coverage = coverageFor(radius);
    const cells = new Set(
      cellsAround(LAT, LON, coverage.tier, geohash, coverage.rings),
    );
    const length = TIER_LENGTH[coverage.tier];

    // Points at the edge of the radius, in each direction. Every one must fall
    // in a cell the search actually looks at — this is the bug an integration
    // test caught: a hundred-metre search over nineteen-metre cells was looking
    // at one ring and quietly missing anything past about twenty metres.
    const degreesNorth = radius / 111_320;

    for (const [dLat, dLon] of [
      [degreesNorth, 0],
      [-degreesNorth, 0],
      [0, degreesNorth],
      [0, -degreesNorth],
    ] as const) {
      const cell = geohash(LAT + dLat, LON + dLon, length);

      assert.ok(cells.has(cell), `${dLat},${dLon} fell outside the searched cells`);
    }
  });
});
