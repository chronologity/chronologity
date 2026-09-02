import type { Coordinates } from "@chronologity/contracts";

/**
 * Reading the coordinates a camera wrote into a photograph.
 *
 * Pure reasoning over bytes, so it needs no decoder, no network, and no
 * storage — which matters because this is where the subtle mistakes live. A
 * sign dropped here does not crash anything; it silently moves someone from
 * London to somewhere off the coast of Ghana.
 *
 * Nothing read here is ever stored. It is offered to the photograph's owner as
 * a suggestion and then forgotten: the coordinates are already inside the file
 * they uploaded, and copying them into a database would create a second thing
 * to leak, to keep in step with privacy rules, and to remember during erasure.
 */

/** What a camera records: degrees, minutes and seconds, plus a hemisphere. */
export interface DegreesMinutesSeconds {
  readonly degrees: number;
  readonly minutes: number;
  readonly seconds: number;
}

/**
 * Turn degrees, minutes and seconds into a single number.
 *
 * @param dms - As a camera records it. Always positive: which side of the
 *   equator or meridian is carried separately.
 * @param reference - `N`, `S`, `E` or `W`.
 * @returns The coordinate in decimal degrees, negative south of the equator and
 *   west of the meridian. Undefined if the reference is not one of the four, or
 *   the parts are not numbers — a coordinate that cannot be trusted must be
 *   absent rather than approximate, since an offered suggestion becomes
 *   somebody's history.
 */
export function toDecimalDegrees(
  dms: DegreesMinutesSeconds,
  reference: string,
): number | undefined {
  const { degrees, minutes, seconds } = dms;

  if (![degrees, minutes, seconds].every((part) => Number.isFinite(part))) {
    return undefined;
  }

  const magnitude = Math.abs(degrees) + Math.abs(minutes) / 60 + Math.abs(seconds) / 3600;
  const hemisphere = reference.trim().toUpperCase();

  // South and west are negative. Getting this wrong does not fail loudly: it
  // quietly relocates someone to the opposite hemisphere.
  if (hemisphere === "N" || hemisphere === "E") {
    return magnitude;
  }

  if (hemisphere === "S" || hemisphere === "W") {
    return -magnitude;
  }

  return undefined;
}

/** The subset of a parsed EXIF block this needs. */
export interface ExifGpsBlock {
  GPSLatitude?: unknown;
  GPSLatitudeRef?: unknown;
  GPSLongitude?: unknown;
  GPSLongitudeRef?: unknown;
}

/**
 * Read the coordinates out of a parsed EXIF block.
 *
 * @param gps - The GPS section of a photograph's metadata, if it had one.
 * @returns Where the photograph says it was taken, or undefined when it says
 *   nothing usable. A photograph without coordinates is entirely ordinary —
 *   scanned prints, screenshots, and anything with location turned off — so
 *   absence is an answer rather than a failure.
 */
export function readCoordinates(gps: ExifGpsBlock | undefined): Coordinates | undefined {
  if (gps === undefined) {
    return undefined;
  }

  const latitude = toDecimalDegrees(
    asDegreesMinutesSeconds(gps.GPSLatitude),
    asReference(gps.GPSLatitudeRef),
  );
  const longitude = toDecimalDegrees(
    asDegreesMinutesSeconds(gps.GPSLongitude),
    asReference(gps.GPSLongitudeRef),
  );

  if (latitude === undefined || longitude === undefined) {
    return undefined;
  }

  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return undefined;
  }

  // Cameras that failed to get a fix sometimes write zeroes rather than
  // nothing. The point in the Gulf of Guinea where both are zero is a real
  // place, but a photograph claiming it is almost always claiming nothing.
  if (latitude === 0 && longitude === 0) {
    return undefined;
  }

  return { latitude, longitude };
}

/**
 * Read the three parts of a coordinate.
 *
 * @param value - As a parser returned it, which is normally an array of three
 *   numbers.
 * @returns The parts, with anything missing left as `NaN` so the conversion
 *   refuses it rather than treating absence as zero.
 */
function asDegreesMinutesSeconds(value: unknown): DegreesMinutesSeconds {
  const parts = Array.isArray(value) ? value : [];

  return {
    degrees: Number(parts[0] ?? Number.NaN),
    minutes: Number(parts[1] ?? Number.NaN),
    seconds: Number(parts[2] ?? Number.NaN),
  };
}

/**
 * Read a hemisphere.
 *
 * @param value - As a parser returned it. Cameras write a trailing null, and
 *   some parsers hand it back with the null still attached.
 * @returns The letter, or an empty string when there is none — which the
 *   conversion treats as unusable.
 */
function asReference(value: unknown): string {
  return typeof value === "string" ? value.replace(/\0/g, "") : "";
}

/**
 * Read the location a camera wrote into a video.
 *
 * Videos record this quite differently from photographs: one string in the
 * container, in the notation ISO 6709 defines, which a decoder hands over
 * already parsed out of the file. So this needs no byte-walking — only care
 * about the notation, which has two forms that look alike and mean very
 * different things.
 *
 * @param value - The tag as the decoder reported it, typically something like
 *   `+51.5007-0.1246/`.
 * @returns Where the video says it was taken, or undefined when the tag is
 *   absent or written in a form that cannot be read with confidence.
 */
export function readIso6709(value: string | undefined): Coordinates | undefined {
  if (value === undefined) {
    return undefined;
  }

  // Both parts always carry an explicit sign, which is what makes the string
  // splittable at all: there is no separator between latitude and longitude.
  const match = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(value.trim());

  if (match === null) {
    return undefined;
  }

  const [, rawLatitude, rawLongitude] = match;

  // The standard also permits packing degrees, minutes and seconds together as
  // digits — `+512700-0000730/` is the same place as `+51.45-0.125/`. Read as
  // a decimal it becomes a latitude of five hundred thousand degrees. The
  // range check below refuses that, so the two forms cannot be confused, and a
  // video written in the packed form yields nothing rather than nonsense.
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return undefined;
  }

  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return undefined;
  }

  if (latitude === 0 && longitude === 0) {
    return undefined;
  }

  return { latitude, longitude };
}

/** The two spellings of the same tag. QuickTime writes the first. */
const LOCATION_TAGS = ["com.apple.quicktime.location.ISO6709", "location"] as const;

/**
 * Pull a video's location tag out of a decoder's report.
 *
 * @param stdout - What the decoder printed.
 * @returns The tag as written, or undefined when the report holds none. A
 *   report that does not parse is treated as saying nothing: the only question
 *   being asked is whether a location is there, and an unreadable answer is
 *   indistinguishable from no.
 */
export function readLocationTag(stdout: string): string | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }

  // `JSON.parse("null")` succeeds, so surviving the parse is not the same as
  // having an object to read fields from.
  if (typeof parsed !== "object" || parsed === null || !("format" in parsed)) {
    return undefined;
  }

  const format = parsed.format;

  if (typeof format !== "object" || format === null || !("tags" in format)) {
    return undefined;
  }

  const tags = format.tags;

  if (typeof tags !== "object" || tags === null) {
    return undefined;
  }

  const record = tags as Record<string, unknown>;

  for (const tag of LOCATION_TAGS) {
    const value = record[tag];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

/**
 * Find a photograph's metadata block.
 *
 * @param bytes - The start of a JPEG. Only the first part is needed: the block
 *   sits near the front, which is why a whole file never has to be fetched.
 * @returns The block's contents ready for parsing, or undefined if the file
 *   carries none or is not a JPEG at all.
 */
export function findExifBlock(bytes: Uint8Array): Uint8Array | undefined {
  // Every JPEG starts with these two bytes. Anything else is not one, whatever
  // its name says — and by this point the file has already been established as
  // a real image, so this is a guard rather than a check.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;

  // Segments run in sequence, each announcing its own length. Walking them is
  // safer than searching for the marker bytes, which occur inside image data
  // often enough to find a convincing fake.
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return undefined;
    }

    const marker = bytes[offset + 1]!;

    // Start of scan: image data begins and there are no more headers.
    if (marker === 0xda) {
      return undefined;
    }

    const length = ((bytes[offset + 2]! << 8) | bytes[offset + 3]!) - 2;

    if (length < 0 || offset + 4 + length > bytes.length) {
      return undefined;
    }

    if (marker === 0xe1) {
      const segment = bytes.subarray(offset + 4, offset + 4 + length);
      const header = Buffer.from(segment.subarray(0, 6)).toString("latin1");

      // APP1 also carries XMP, which starts differently. Only EXIF is wanted.
      if (header === "Exif\0\0") {
        return segment;
      }
    }

    offset += 4 + length;
  }

  return undefined;
}
