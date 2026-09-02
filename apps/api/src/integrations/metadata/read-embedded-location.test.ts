import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  findExifBlock,
  readCoordinates,
  readIso6709,
  readLocationTag,
  toDecimalDegrees,
} from "./read-embedded-location.js";

/**
 * Reading where a photograph says it was taken.
 *
 * Worth testing hard for a reason that has nothing to do with how complicated
 * it is. A dropped sign here does not throw, does not fail a build, and does
 * not look wrong: it produces a perfectly plausible coordinate in the wrong
 * hemisphere, which then gets offered to someone as a suggestion about their
 * own history.
 */

const GPS_PHOTOGRAPH = new URL(
  "../../features/uploads/__fixtures__/photo-with-gps.jpg",
  import.meta.url,
);

describe("toDecimalDegrees", () => {
  it("adds up degrees, minutes and seconds", () => {
    const dms = { degrees: 51, minutes: 30, seconds: 2.52 };

    const decimal = toDecimalDegrees(dms, "N");

    assert.ok(decimal !== undefined);
    assert.ok(Math.abs(decimal - 51.5007) < 0.000_01);
  });

  it("puts the southern hemisphere below the equator", () => {
    const dms = { degrees: 33, minutes: 51, seconds: 32.4 };

    assert.equal(toDecimalDegrees(dms, "S"), -toDecimalDegrees(dms, "N")!);
  });

  it("puts the western hemisphere left of the meridian", () => {
    const dms = { degrees: 74, minutes: 0, seconds: 21.6 };

    assert.equal(toDecimalDegrees(dms, "W"), -toDecimalDegrees(dms, "E")!);
  });

  it("keeps the sign when the degrees are zero", () => {
    // Greenwich is a few minutes wide. Anywhere just west of it has zero
    // degrees and a negative coordinate, which is exactly the case an
    // implementation that negates the degrees alone gets wrong.
    const justWestOfGreenwich = { degrees: 0, minutes: 7, seconds: 28.56 };

    const decimal = toDecimalDegrees(justWestOfGreenwich, "W");

    assert.ok(decimal !== undefined);
    assert.ok(decimal < 0);
    assert.ok(Math.abs(decimal - -0.1246) < 0.000_01);
  });

  it("reads a hemisphere however the camera wrote it", () => {
    const dms = { degrees: 10, minutes: 0, seconds: 0 };

    // Cameras terminate the string with a null, and parsers differ on whether
    // they strip it.
    assert.equal(toDecimalDegrees(dms, "s"), -10);
    assert.equal(toDecimalDegrees(dms, " S "), -10);
  });

  it("refuses a hemisphere it does not recognise", () => {
    const dms = { degrees: 10, minutes: 0, seconds: 0 };

    for (const reference of ["", "X", "NS", "north"]) {
      assert.equal(toDecimalDegrees(dms, reference), undefined, reference);
    }
  });

  it("refuses parts that are not numbers", () => {
    // Absence must not read as zero. A coordinate assembled from missing parts
    // is a confident claim about the middle of the Atlantic.
    assert.equal(toDecimalDegrees({ degrees: Number.NaN, minutes: 0, seconds: 0 }, "N"), undefined);
    assert.equal(toDecimalDegrees({ degrees: 1, minutes: Number.NaN, seconds: 0 }, "N"), undefined);
    assert.equal(toDecimalDegrees({ degrees: 1, minutes: 0, seconds: Number.NaN }, "N"), undefined);
    assert.equal(
      toDecimalDegrees({ degrees: Number.POSITIVE_INFINITY, minutes: 0, seconds: 0 }, "N"),
      undefined,
    );
  });
});

describe("readCoordinates", () => {
  const london = {
    GPSLatitude: [51, 30, 2.52],
    GPSLatitudeRef: "N",
    GPSLongitude: [0, 7, 28.56],
    GPSLongitudeRef: "W",
  };

  it("reads a complete set of coordinates", () => {
    const coordinates = readCoordinates(london);

    assert.ok(coordinates !== undefined);
    assert.ok(Math.abs(coordinates.latitude - 51.5007) < 0.000_01);
    assert.ok(Math.abs(coordinates.longitude - -0.1246) < 0.000_01);
  });

  it("treats a photograph with no metadata as having nothing to say", () => {
    // Not an error. Scanned prints, screenshots, and anyone who turned location
    // off all arrive this way, and they are the ordinary case.
    assert.equal(readCoordinates(undefined), undefined);
    assert.equal(readCoordinates({}), undefined);
  });

  it("refuses a half-written set", () => {
    for (const missing of [
      "GPSLatitude",
      "GPSLatitudeRef",
      "GPSLongitude",
      "GPSLongitudeRef",
    ] as const) {
      const partial = { ...london, [missing]: undefined };

      assert.equal(readCoordinates(partial), undefined, missing);
    }
  });

  it("refuses coordinates that are not on the Earth", () => {
    const impossible = { ...london, GPSLatitude: [91, 0, 0] };
    const alsoImpossible = { ...london, GPSLongitude: [181, 0, 0] };

    assert.equal(readCoordinates(impossible), undefined);
    assert.equal(readCoordinates(alsoImpossible), undefined);
  });

  it("refuses the null island", () => {
    // Both zero is a real point in the Gulf of Guinea and almost never where
    // anybody was. It is what a camera writes when it never got a fix.
    const noFix = {
      GPSLatitude: [0, 0, 0],
      GPSLatitudeRef: "N",
      GPSLongitude: [0, 0, 0],
      GPSLongitudeRef: "E",
    };

    assert.equal(readCoordinates(noFix), undefined);
  });

  it("accepts the poles and the meridian themselves", () => {
    const equatorial = {
      GPSLatitude: [0, 0, 0],
      GPSLatitudeRef: "N",
      GPSLongitude: [78, 30, 0],
      GPSLongitudeRef: "E",
    };

    assert.deepEqual(readCoordinates(equatorial), { latitude: 0, longitude: 78.5 });
  });

  it("ignores a trailing null in the hemisphere", () => {
    const withNull = { ...london, GPSLatitudeRef: "N\0", GPSLongitudeRef: "W\0" };

    assert.deepEqual(readCoordinates(withNull), readCoordinates(london));
  });

  it("refuses parts that are not what a parser should have produced", () => {
    for (const value of ["51,30,2", 51.5, null, {}, [51, 30]]) {
      const wrong = { ...london, GPSLatitude: value };

      assert.equal(readCoordinates(wrong), undefined, JSON.stringify(value));
    }
  });
});

describe("readIso6709 — how a video records the same thing", () => {
  it("reads a signed pair", () => {
    assert.deepEqual(readIso6709("+51.5007-0.1246/"), { latitude: 51.5007, longitude: -0.1246 });
  });

  it("reads a pair with no trailing solidus", () => {
    assert.deepEqual(readIso6709("+51.5007-0.1246"), { latitude: 51.5007, longitude: -0.1246 });
  });

  it("ignores an altitude", () => {
    // Phones append height above sea level. It is a third component of the
    // same string and has nothing to do with where on the Earth this is.
    assert.deepEqual(readIso6709("+51.5007-0.1246+010.500/"), {
      latitude: 51.5007,
      longitude: -0.1246,
    });
  });

  it("keeps both hemispheres straight", () => {
    assert.deepEqual(readIso6709("-33.8688+151.2093/"), {
      latitude: -33.8688,
      longitude: 151.2093,
    });
  });

  it("reads whole numbers of degrees", () => {
    assert.deepEqual(readIso6709("+51-001/"), { latitude: 51, longitude: -1 });
  });

  it("refuses the packed notation rather than misreading it", () => {
    // `+512700-0000730/` is degrees, minutes and seconds run together, and is
    // a perfectly legal way to write the same coordinate. Read as a decimal it
    // is a latitude of half a million degrees, so it must produce nothing.
    assert.equal(readIso6709("+512700-0000730/"), undefined);
  });

  it("refuses a tag that is absent or unsigned", () => {
    // Without signs there is nothing marking where latitude ends.
    for (const value of [undefined, "", "51.5007,-0.1246", "somewhere", "/"]) {
      assert.equal(readIso6709(value), undefined, String(value));
    }
  });

  it("refuses coordinates that are not on the Earth", () => {
    assert.equal(readIso6709("+91.0-0.1246/"), undefined);
    assert.equal(readIso6709("+51.5-181.0/"), undefined);
  });

  it("refuses the null island", () => {
    assert.equal(readIso6709("+0.0+0.0/"), undefined);
  });
});

describe("readLocationTag", () => {
  const report = (tags: Record<string, unknown>): string => JSON.stringify({ format: { tags } });

  it("reads the plain tag", () => {
    assert.equal(readLocationTag(report({ location: "+51.5007-0.1246/" })), "+51.5007-0.1246/");
  });

  it("reads the Apple tag", () => {
    const apple = report({ "com.apple.quicktime.location.ISO6709": "-33.8688+151.2093/" });

    assert.equal(readLocationTag(apple), "-33.8688+151.2093/");
  });

  it("prefers the Apple tag when a file carries both", () => {
    // A phone writes both, and the Apple one is the more precise of the two.
    const both = report({
      location: "+51.50-0.12/",
      "com.apple.quicktime.location.ISO6709": "+51.5007-0.1246+010.500/",
    });

    assert.equal(readLocationTag(both), "+51.5007-0.1246+010.500/");
  });

  it("falls back to the plain tag when the Apple one is empty", () => {
    const empty = report({
      location: "+51.5007-0.1246/",
      "com.apple.quicktime.location.ISO6709": "  ",
    });

    assert.equal(readLocationTag(empty), "+51.5007-0.1246/");
  });

  it("reports nothing for a video carrying no location", () => {
    assert.equal(readLocationTag(report({ encoder: "Lavf61" })), undefined);
    assert.equal(readLocationTag(JSON.stringify({ format: {} })), undefined);
    assert.equal(readLocationTag(JSON.stringify({})), undefined);
  });

  it("reports nothing for a report it cannot read", () => {
    for (const nonsense of ["", "not json", "{", "null", "[]", '{"format":null}']) {
      assert.equal(readLocationTag(nonsense), undefined, nonsense);
    }
  });

  it("reports nothing for a tag that is not text", () => {
    assert.equal(readLocationTag(report({ location: 51.5 })), undefined);
    assert.equal(readLocationTag(report({ location: null })), undefined);
  });
});

describe("findExifBlock", () => {
  it("finds the block in a real photograph", () => {
    const bytes = readFileSync(GPS_PHOTOGRAPH);

    const block = findExifBlock(bytes);

    assert.ok(block !== undefined);
    assert.equal(Buffer.from(block.subarray(0, 4)).toString("latin1"), "Exif");
  });

  it("finds the block from the front of a photograph alone", () => {
    // The whole point of walking the segments: the block sits near the start,
    // so a location can be read without pulling down a large file.
    const bytes = readFileSync(GPS_PHOTOGRAPH);

    const block = findExifBlock(bytes.subarray(0, 4096));

    assert.ok(block !== undefined);
  });

  it("reports nothing for something that is not a photograph", () => {
    assert.equal(findExifBlock(Buffer.from("not an image at all")), undefined);
    assert.equal(findExifBlock(Buffer.alloc(0)), undefined);
    assert.equal(findExifBlock(Buffer.from([0xff])), undefined);
  });

  it("reports nothing for a photograph carrying no metadata", () => {
    // A minimal JPEG: start of image, a comment segment, then image data.
    const bare = Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda]);

    assert.equal(findExifBlock(bare), undefined);
  });

  it("does not mistake the other kind of metadata for this one", () => {
    // XMP travels in the same segment type. Handing its bytes to a parser
    // expecting the other format is how a decoder ends up reading rubbish.
    const header = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1");
    const xmp = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
      Buffer.from([((header.length + 2) >> 8) & 0xff, (header.length + 2) & 0xff]),
      header,
      Buffer.from([0xff, 0xda]),
    ]);

    assert.equal(findExifBlock(xmp), undefined);
  });

  it("stops rather than reading past the end of a truncated file", () => {
    // A segment claiming more bytes than the file holds. Trusting the claim
    // reads whatever memory follows.
    const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45, 0x78]);

    assert.equal(findExifBlock(truncated), undefined);
  });

  it("stops at a segment that does not begin where one should", () => {
    const corrupt = Buffer.from([0xff, 0xd8, 0x00, 0xe1, 0x00, 0x08, 0x45, 0x78]);

    assert.equal(findExifBlock(corrupt), undefined);
  });
});
