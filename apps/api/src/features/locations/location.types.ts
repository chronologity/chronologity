import type {
  Coordinates,
  GeographicContext,
  LocationPrecision,
  LocationSource,
} from "@chronologity/contracts";

/**
 * A place about to be recorded.
 *
 * Everything is settled before it reaches the repository: the identifier is
 * generated, the wider areas are filled in, and the position has been checked
 * against the confidence claimed for it. The repository writes, and decides
 * nothing.
 */
export interface NewLocation {
  readonly locationId: string;
  /** Who recorded it. */
  readonly recordedByUserId: string;
  /**
   * The name as it was understood at this moment, and never rewritten by a
   * later lookup. This is what makes historical naming work.
   */
  readonly name: string;
  readonly coordinates: Coordinates | undefined;
  /** How precisely the position is known. Recorded, never inferred. */
  readonly precision: LocationPrecision;
  readonly context: GeographicContext;
  /** Where in the map service this came from, if it did. Provenance, never identity. */
  readonly sourceReference: string | undefined;
  /**
   * How the place came to be known.
   *
   * Not all sources carry the same authority, and the difference cannot be
   * recovered once it is lost (`locations.md:333`).
   */
  readonly source: LocationSource;
  readonly createdAt: Date;
}
