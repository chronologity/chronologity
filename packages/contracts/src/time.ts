import { z } from "zod";

/**
 * Serialized timestamps are ISO-8601 with an explicit offset.
 *
 * An offset is required rather than optional: Chronologity records when things
 * happened in the world, and a timestamp without a zone cannot be placed in
 * history without guessing.
 */
export const timestampSchema = z.iso.datetime({ offset: true });

export type Timestamp = z.infer<typeof timestampSchema>;

/**
 * Occurrence time: when the represented experience happened.
 *
 * This determines historical position. It is not the time the record was
 * created, and it may precede it by decades.
 */
export const occurredAtSchema = timestampSchema;

/**
 * Recording time: when Chronologity learned about it.
 *
 * Useful for provenance, auditing, and synchronization. It never determines
 * historical position.
 */
export const recordedAtSchema = timestampSchema;

/**
 * The precision at which an occurrence is known.
 *
 * History arrives imprecisely. A Moment known only as "summer 1998" must not
 * acquire a fabricated exact timestamp to make storage or filtering easier, so
 * precision travels with the occurrence rather than being inferred from it.
 */
export const temporalPrecisionSchema = z.enum(["instant", "day", "month", "year"]);

export type TemporalPrecision = z.infer<typeof temporalPrecisionSchema>;

/**
 * An occurrence with its known precision.
 *
 * `start` and `end` bound the interval the occurrence is known to fall within.
 * For `instant` precision they are equal.
 */
export const occurrenceSchema = z
  .object({
    start: occurredAtSchema,
    end: occurredAtSchema,
    precision: temporalPrecisionSchema,
  })
  .refine(({ start, end }) => Date.parse(start) <= Date.parse(end), {
    message: "Occurrence interval must not end before it starts",
    path: ["end"],
  });

export type Occurrence = z.infer<typeof occurrenceSchema>;
