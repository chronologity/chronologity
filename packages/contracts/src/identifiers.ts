import { z } from "zod";

/**
 * Every Chronologity identifier is a UUID in its serialized form.
 *
 * Identity is stable and independent of names, handles, aliases, coordinates,
 * and external provider identifiers. A rename or a merge never changes an
 * entity's identifier.
 */
export const identifierSchema = z.uuid();

export type Identifier = z.infer<typeof identifierSchema>;

/**
 * Produce a branded identifier schema.
 *
 * Branding separates identifier kinds at compile time without costing anything
 * at runtime: a `UserId` cannot be passed where a `MomentId` is expected, but
 * both are plain UUID strings once serialized.
 *
 * Domain-specific identifiers are declared by the feature that owns them, as
 * that domain is implemented, rather than being enumerated here in advance.
 *
 * @returns A schema for a UUID branded as one kind of identifier, so a UserId
 *   cannot be passed where a MomentId is expected. Nothing changes at runtime;
 *   both are plain UUID strings once serialized.
 */
export function brandedIdentifier<const Brand extends string>() {
  return identifierSchema.brand<Brand>();
}

/** Identifies the aggregate an event belongs to. Aggregate types are strings owned by their domain. */
export const aggregateReferenceSchema = z.object({
  type: z.string().min(1),
  id: identifierSchema,
  version: z.number().int().nonnegative(),
});

export type AggregateReference = z.infer<typeof aggregateReferenceSchema>;
