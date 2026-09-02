import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";

/**
 * What a Timeline request *is*.
 *
 * A View Specification describes a perspective on history — whose or what,
 * over which stretch of time, at what zoom, seen which way, and where the reader
 * had got to. It is the engine's only input, whether it arrives from live
 * navigation, a Saved View, a shared link, discovery or a curated path
 * (`saved-views.md:422`).
 *
 * **Product concepts only.** Nothing here names a table, a column, an index or
 * a query language, and nothing may. `roadmap.md:800` forbids it, and the reason
 * is that this object outlives the engine: it will be stored by Saved Views and
 * reopened against an engine nobody has written yet.
 *
 * That is also why it carries a version. Preserving identical Moment results
 * forever is not the goal; preserving what a saved perspective *meant* is.
 */

/**
 * The specification's version.
 *
 * Bumped when the meaning of a field changes, never when a field is added — an
 * addition is readable by an older reader and a change is not.
 */
export const DERIVATION_VERSION = 1;

/**
 * What kind of thing a view is about.
 *
 * `saved-views.md:145` also names a subject and a Collection as possible, and
 * neither exists as a product concept yet. They are absent rather than stubbed:
 * a context type that resolves to nothing would be a saved view that cannot
 * open.
 */
export const viewContextTypeSchema = z.enum(["person", "location", "real_world_event"]);

export type ViewContextType = z.infer<typeof viewContextTypeSchema>;

/** Whose or what history is being explored. */
export const viewContextSchema = z.object({
  type: viewContextTypeSchema,
  id: identifierSchema,
});

export type ViewContext = z.infer<typeof viewContextSchema>;

/**
 * Which lens is applied to the context's Moments.
 *
 * Context type says whose history; this says which of it. A person's Timeline is
 * what they recorded together with what they took part in, and "what my father
 * photographed" and "where my father was" are different questions about the same
 * person.
 *
 * A Location and a real-world Event have one perspective, `all`: nothing about a
 * place distinguishes recording from taking part. Anything else on such a
 * context is refused rather than ignored, because a saved view that quietly
 * meant something other than it said would be worse than one that failed.
 */
export const viewPerspectiveSchema = z.enum(["all", "authored", "participated"]);

export type ViewPerspective = z.infer<typeof viewPerspectiveSchema>;

/**
 * How coarsely history is being read.
 *
 * `day` is here and absent from the Timeline's bucket scales, which stop at a
 * year. A specification describes what somebody asked for; what the projection
 * can currently count is a separate question, and the narrower of the two is not
 * the one worth persisting.
 */
export const viewZoomSchema = z.enum(["day", "year", "decade"]);

export type ViewZoom = z.infer<typeof viewZoomSchema>;

/**
 * A stretch of history, meant literally.
 *
 * Reopening it gives the same interval it always gave: August 1969 in 2026 is
 * August 1969 in 2036.
 */
export const fixedRangeSchema = z.object({
  kind: z.literal("fixed"),
  from: timestampSchema,
  to: timestampSchema,
});

/**
 * A stretch of history evaluated when the view is opened.
 *
 * **The definition is stored, never the dates it resolved to.** "This year" saved
 * in 2026 and reopened in 2027 means 2027 — resolving it at save time would turn
 * every rolling range into a fixed one silently, which is the mistake
 * `saved-views.md:200` exists to prevent.
 */
export const rollingRangeSchema = z.object({
  kind: z.literal("rolling"),
  /** The unit the window is counted in. */
  unit: z.enum(["day", "month", "year"]),
  /**
   * How many of them, counting back from now.
   *
   * `{ unit: "day", count: 30 }` is the last thirty days.
   */
  count: z.number().int().min(1).max(1000),
});

export const viewRangeSchema = z.discriminatedUnion("kind", [
  fixedRangeSchema,
  rollingRangeSchema,
]);

export type ViewRange = z.infer<typeof viewRangeSchema>;

/**
 * Narrowing within a context, without changing what the context is.
 *
 * Closed and enumerated on purpose. A Timeline is chronology over a context and
 * Search is what answers questions; an engine accepting arbitrary predicates
 * would become a second query language beside Search, which is the failure this
 * whole object exists to prevent. An open set could not be persisted safely
 * either, because nothing would bound what a stored view might ask of a later
 * engine.
 *
 * A filter naming the same kind of thing as the context is refused: filtering a
 * Location's Timeline by that Location says nothing, and by a different one can
 * never hold anything.
 */
export const viewFiltersSchema = z
  .object({
    /** Only Moments this person recorded. */
    authorUserId: identifierSchema.optional(),
    /** Only Moments at this place. */
    locationId: identifierSchema.optional(),
    /** Only Moments that were part of this occurrence. */
    realWorldEventId: identifierSchema.optional(),
  })
  // Strict, because the default is worse than an error here. An unrecognised
  // filter would otherwise be dropped in silence, and a saved view asking to be
  // narrowed that opens unnarrowed shows its owner more history than they asked
  // for — the one failure direction this object must not have.
  .strict();

export type ViewFilters = z.infer<typeof viewFiltersSchema>;

/**
 * Where in history the reader is.
 *
 * An anchor is where they asked to be; a position is where they got to. Both are
 * kept because they answer different questions on reopening: an anchor says what
 * the view was *about*, and a position says where to resume.
 */
export const viewPositionSchema = z.object({
  /** The instant the view was aimed at, which need not be one anything happened. */
  anchoredAt: timestampSchema.optional(),
  /** A Moment the view was aimed at. */
  anchorMomentId: identifierSchema.optional(),
  /** An opaque cursor this system issued. Never constructed by a client. */
  cursor: z.string().max(500).optional(),
});

export type ViewPosition = z.infer<typeof viewPositionSchema>;

/**
 * A perspective on history, entire.
 *
 * Everything a reader needs to reopen what they were looking at, and nothing
 * about how it would be fetched.
 */
export const viewSpecificationSchema = z
  .strictObject({
    /**
     * What the fields meant when this was written.
     *
     * Read leniently and upgraded where it can be. Unlike a cursor — which is
     * refused when its version is unrecognised, because losing one costs a
     * restart — a specification may be somebody's saved view, and refusing it
     * is that view failing to open. `saved-views.md:379` asks for migration.
     */
    derivationVersion: z.number().int().min(1).default(DERIVATION_VERSION),
    context: viewContextSchema,
    perspective: viewPerspectiveSchema.default("all"),
    range: viewRangeSchema.optional(),
    zoom: viewZoomSchema.optional(),
    filters: viewFiltersSchema.default({}),
    position: viewPositionSchema.default({}),
    /** How many Moments a page holds. Bounded so one request cannot ask for a life. */
    limit: z.number().int().min(1).max(200).default(50),
    /** Which way a page runs through history. */
    direction: z.enum(["older", "newer"]).default("older"),
  })
  .superRefine((view, ctx) => {
    if (view.context.type !== "person" && view.perspective !== "all") {
      ctx.addIssue({
        code: "custom",
        path: ["perspective"],
        message:
          "Only a person's Timeline distinguishes what they recorded from what they took part in",
      });
    }

    // A filter naming the same kind of thing as the context. Refused rather
    // than ignored: one form says nothing and the other can never hold
    // anything, and both are likelier to be a mistake than an intention.
    const clash: Record<ViewContextType, keyof ViewFilters> = {
      person: "authorUserId",
      location: "locationId",
      real_world_event: "realWorldEventId",
    };
    const field = clash[view.context.type];

    if (view.filters[field] !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["filters", field],
        message: "That filter names the same kind of thing the view is already about",
      });
    }
  });

export type ViewSpecification = z.infer<typeof viewSpecificationSchema>;
