/**
 * Geographic retrieval over the indexed cells.
 *
 * Pure. The index holds truncated geohashes rather than points, because a
 * Viewer entitled to know somebody was in a city is not thereby entitled to the
 * doorway — and an index that does not hold the doorway cannot leak it, however
 * the query is written.
 *
 * Everything here follows from that. A radius is answered at the granularity
 * the stored cells can honestly support, and the answer says which that was.
 */

/** The three tiers 5O-1 indexes, and how exact each is. */
export type GeoTier = "exact" | "neighbourhood" | "region";

/** How many characters each tier keeps. */
export const TIER_LENGTH: Readonly<Record<GeoTier, number>> = {
  exact: 8,
  neighbourhood: 5,
  region: 3,
};

/**
 * How far a cell reaches at each tier, in metres.
 *
 * The **shorter** side, not the longer one. A geohash cell is a rectangle and
 * at odd bit counts it is markedly taller than it is wide — at the finest tier
 * it spans about thirty-eight metres of longitude and nineteen of latitude.
 * Sizing rings by the longer side leaves the shorter one uncovered, which is
 * exactly how a hundred-metre search came to look at twenty metres and report
 * nothing rather than report that it could not.
 *
 * Approximate by nature: cells narrow towards the poles, and these are
 * equatorial figures used to choose a tier rather than to measure anything.
 */
const TIER_WIDTH_METRES: Readonly<Record<GeoTier, number>> = {
  exact: 19,
  neighbourhood: 4_890,
  region: 156_000,
};

const GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * How many rings of cells may be searched at once.
 *
 * Eight reaches two hundred and eighty-nine cells, which is a large `IN` on an
 * indexed column and no more than that. The bound is what keeps a query
 * somebody types from turning into arbitrary work, and it is why a radius too
 * wide for a tier steps to a coarser one rather than asking for more cells.
 */
const MAX_RINGS = 8;

/** Which cells to search, and how far out. */
export interface GeoCoverage {
  readonly tier: GeoTier;
  /** How many cells out from the centre. One ring is the eight around it. */
  readonly rings: number;
}

/**
 * How to cover a radius.
 *
 * The finest tier that can cover the radius within the ring bound, so a small
 * radius is answered precisely and a large one does not ask for thousands of
 * cells.
 *
 * The ring count matters as much as the tier, and getting it wrong is silent.
 * A single ring reaches one cell in each direction — about nineteen metres at
 * the finest tier — so a hundred-metre search covered by one ring would miss
 * most of what it claimed to look at, and report nothing rather than report
 * that it could not.
 *
 * @param radiusMetres - How far around the point to look.
 * @returns The tier and the number of rings. Coverage is complete and slightly
 *   generous: cells are squares and a radius is a circle, so the corners reach
 *   further than asked. Returning a little too much is the right way to be
 *   wrong — the alternative loses history without saying so.
 */
export function coverageFor(radiusMetres: number): GeoCoverage {
  for (const tier of ["exact", "neighbourhood", "region"] as const) {
    const rings = Math.ceil(radiusMetres / TIER_WIDTH_METRES[tier]);

    if (rings <= MAX_RINGS) {
      return { tier, rings: Math.max(1, rings) };
    }
  }

  return { tier: "region", rings: MAX_RINGS };
}

/**
 * Decode a geohash back to the box it names.
 *
 * @param hash - The geohash.
 * @returns The box's bounds in degrees.
 * @throws {Error} If the hash contains a character the alphabet does not have,
 *   which means it did not come from this system.
 */
export function decode(hash: string): {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
} {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let even = true;

  for (const character of hash) {
    const index = GEOHASH_ALPHABET.indexOf(character);

    if (index === -1) {
      throw new Error(`Not a geohash: ${JSON.stringify(hash)}`);
    }

    for (let bit = 4; bit >= 0; bit -= 1) {
      const set = ((index >> bit) & 1) === 1;

      if (even) {
        const mid = (lonMin + lonMax) / 2;

        if (set) {
          lonMin = mid;
        } else {
          lonMax = mid;
        }
      } else {
        const mid = (latMin + latMax) / 2;

        if (set) {
          latMin = mid;
        } else {
          latMax = mid;
        }
      }

      even = !even;
    }
  }

  return { latMin, latMax, lonMin, lonMax };
}

/**
 * The cell containing a point, and the eight around it.
 *
 * Without the neighbours, proximity search is visibly broken exactly at cell
 * boundaries: a place a hundred metres away sits in the adjacent cell and a
 * prefix match alone never finds it.
 *
 * Computed by stepping one cell in each direction from the centre rather than
 * by bit arithmetic, which is easier to be wrong about and no faster at this
 * size.
 *
 * @param latitude - Degrees north of the point being searched from.
 * @param longitude - Degrees east.
 * @param tier - Which tier's cells to name.
 * @param encode - How to encode a position, injected so this module stays
 *   independent of the document builder that owns the encoder.
 * @param rings - How many cells out from the centre to reach. One is the eight
 *   immediate neighbours; the caller derives it from the radius, because a
 *   radius wider than a cell needs more than one ring to be covered at all.
 * @returns The distinct cells within that many rings, all of them near the
 *   point. Fewer than nine near a pole, where a step north or south is clamped
 *   to the pole and collapses onto a cell already named — never onto the far
 *   side of the planet. Longitude wraps at the antimeridian rather than
 *   dead-ending, so a search off the coast of Fiji still looks both ways.
 */
export function cellsAround(
  latitude: number,
  longitude: number,
  tier: GeoTier,
  encode: (latitude: number, longitude: number, length: number) => string,
  rings = 1,
): string[] {
  const length = TIER_LENGTH[tier];
  const centre = encode(latitude, longitude, length);
  const box = decode(centre);
  const latStep = box.latMax - box.latMin;
  const lonStep = box.lonMax - box.lonMin;
  const found = new Set<string>([centre]);

  const offsets = Array.from({ length: rings * 2 + 1 }, (_, index) => index - rings);

  for (const latOffset of offsets) {
    for (const lonOffset of offsets) {
      // A step past a pole lands in the pole's own cell, never over the top on
      // the far side of the planet — and that is a property of the encoding
      // rather than of any check. Each step of the subdivision asks whether the
      // latitude is above the midpoint; for anything beyond 90 the answer is
      // always yes, so it converges on the northernmost cell and stops.
      //
      // A guard was written here first and removed: nothing could make it fire,
      // so no test could make it fail. A check that cannot fail is worse than
      // none, because it suggests the case is handled here when it is handled
      // by the arithmetic.
      found.add(
        encode(
          latitude + latOffset * latStep,
          wrapLongitude(longitude + lonOffset * lonStep),
          length,
        ),
      );
    }
  }

  return [...found];
}

/**
 * Bring a longitude back into range across the antimeridian.
 *
 * @param longitude - Degrees east, possibly stepped past the edge of the world.
 * @returns The same meridian expressed within -180 to 180.
 */
function wrapLongitude(longitude: number): number {
  if (longitude > 180) {
    return longitude - 360;
  }

  if (longitude < -180) {
    return longitude + 360;
  }

  return longitude;
}
