import type { Coordinates, GeographicContext, LocationPrecision } from "@chronologity/contracts";
import type { Command } from "../../../types/command.js";

/**
 * Context where any field may be absent or explicitly nothing.
 *
 * Not `Partial<GeographicContext>`: with `exactOptionalPropertyTypes`, that
 * means "the key may be missing", while a parsed request body produces "the
 * key may be present and undefined". The two are genuinely different, and the
 * compiler is right to insist.
 */
type PartialContext = {
  [K in keyof GeographicContext]?: GeographicContext[K] | undefined;
};

/** Record a place. */
export type RecordLocationCommand = Command<
  "RecordLocation",
  {
    recordedByUserId: string;
    name: string;
    coordinates: Coordinates | undefined;
    precision: LocationPrecision;
    context: PartialContext | undefined;
    /** Where in the map service this came from, if it did. */
    sourceReference: string | undefined;
  }
>;

/**
 * Build a {@link RecordLocationCommand}.
 *
 * @param recordedByUserId - Who is recording it.
 * @param input - The name, optional position, how precisely it is known, the
 *   wider areas it sits inside, and an optional map-service reference.
 * @returns The command.
 */
export function recordLocationCommand(
  recordedByUserId: string,
  input: {
    name: string;
    coordinates?: Coordinates | undefined;
    precision: LocationPrecision;
    context?: PartialContext | undefined;
    sourceReference?: string | undefined;
  },
): RecordLocationCommand {
  return {
    type: "RecordLocation",
    payload: {
      recordedByUserId,
      name: input.name,
      coordinates: input.coordinates,
      precision: input.precision,
      context: input.context,
      sourceReference: input.sourceReference,
    },
  };
}
