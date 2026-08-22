import type { Moment } from "@chronologity/contracts";
import { ValidationError } from "../../lib/errors/validation-error.js";
import type { MomentCursor } from "./moment.types.js";

/**
 * Where a page of Moments continues from.
 *
 * Opaque on purpose. A caller that takes a cursor apart and reconstructs it
 * will break the moment the ordering changes, so the encoding says plainly that
 * it is not to be read: base64url of the two values the ordering actually uses.
 *
 * It is not a security boundary and does not pretend to be one. A cursor names
 * a position in one person's own history, and every read is authorized against
 * the caller regardless of what the cursor says — a forged one can only move
 * somebody around inside their own Moments.
 */

/** What separates the two halves. A colon cannot appear in either. */
const SEPARATOR = ":";

/**
 * Encode where the next page continues from.
 *
 * @param moment - The last Moment on the page just returned.
 * @returns The cursor to hand back.
 */
export function encodeCursor(moment: Moment): string {
  const raw = `${moment.occurrence.start}${SEPARATOR}${moment.momentId}`;

  return Buffer.from(raw, "utf8").toString("base64url");
}

/**
 * Decode where a page should continue from.
 *
 * @param cursor - What a caller sent back.
 * @returns The occurrence and identifier to continue after.
 * @throws {ValidationError} If it is not a cursor this module produced. Refused
 *   rather than ignored: silently starting from the beginning would repeat a
 *   page a caller believed it had already read.
 */
export function decodeCursor(cursor: string): MomentCursor {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const separator = raw.lastIndexOf(SEPARATOR);

  if (separator === -1) {
    throw new ValidationError("Malformed cursor", { field: "cursor" });
  }

  const occurrenceStart = new Date(raw.slice(0, separator));
  const momentId = raw.slice(separator + 1);

  if (Number.isNaN(occurrenceStart.getTime()) || momentId.length === 0) {
    throw new ValidationError("Malformed cursor", { field: "cursor" });
  }

  return { occurrenceStart, momentId };
}
