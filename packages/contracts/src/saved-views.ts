import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";
import { publicUserSchema } from "./users.js";
import { viewSpecificationSchema } from "./view-specification.js";

/**
 * Keeping a perspective on history.
 *
 * A Saved View stores a View Specification and a name for it — never a list of
 * Moments. Reopening it derives current history, which is what makes "my
 * father's photographs in Tokyo in the nineties" mean the same thing next year
 * as it does today even though the history behind it has grown.
 *
 * **A Saved View grants nothing.** It is a request somebody wrote down, and it
 * is authorised afresh every time it is opened: a Moment that was public when it
 * was saved shows nothing when it is private now.
 */

/**
 * What somebody called it.
 *
 * Bounded like every other name here, and trimmed on the way in. Not unique and
 * not an identity: two views may reasonably be called "Home".
 */
export const savedViewTitleSchema = z.string().trim().min(1).max(120);

/** Saving what you are looking at. */
export const createSavedViewRequestSchema = z.object({
  title: savedViewTitleSchema,
  view: viewSpecificationSchema,
});

export type CreateSavedViewRequest = z.infer<typeof createSavedViewRequestSchema>;

/** Renaming one. The specification is not editable: that would be a new view. */
export const renameSavedViewRequestSchema = z.object({ title: savedViewTitleSchema });

export type RenameSavedViewRequest = z.infer<typeof renameSavedViewRequestSchema>;

/**
 * A Saved View as its owner sees it.
 *
 * Carries the specification rather than any history, so a client can show what
 * the view is about — a place, a decade, a lens — without deriving it.
 */
export const savedViewSchema = z.object({
  savedViewId: identifierSchema,
  title: savedViewTitleSchema,
  view: viewSpecificationSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  /**
   * Whether the view can still be opened.
   *
   * False when its primary context no longer resolves — a Location merged away,
   * an account gone. `saved-views.md:363` asks that such a view be marked and
   * removable rather than treated as corrupt, because the alternative is
   * somebody's list quietly acquiring an item that errors.
   */
  available: z.boolean(),
});

export type SavedView = z.infer<typeof savedViewSchema>;

/** A page of somebody's saved views. */
export const savedViewListSchema = z.object({
  items: z.array(savedViewSchema),
  nextCursor: z.string().optional(),
});

export type SavedViewList = z.infer<typeof savedViewListSchema>;

/**
 * Creating a link to a view.
 *
 * What the link discloses is the sender's choice, and both default to nothing.
 * A title is somebody's words about their own history, and a link outlives the
 * conversation it was sent in — so revealing has to be an act rather than a
 * consequence of sharing at all.
 *
 * One view may be shared twice on different terms: what suits a sibling need not
 * suit a colleague, which is why this lives on the share and not on the view.
 */
export const createShareRequestSchema = z.object({
  revealsTitle: z.boolean().default(false),
  revealsOwner: z.boolean().default(false),
});

export type CreateShareRequest = z.infer<typeof createShareRequestSchema>;

/** A share, as the person who made it sees it. */
export const savedViewShareSchema = z.object({
  shareId: identifierSchema,
  /** The link's secret. Shown once at creation and on request to its owner. */
  token: z.string(),
  revealsTitle: z.boolean(),
  revealsOwner: z.boolean(),
  createdAt: timestampSchema,
  revokedAt: timestampSchema.optional(),
});

export type SavedViewShare = z.infer<typeof savedViewShareSchema>;

export const savedViewShareListSchema = z.object({
  items: z.array(savedViewShareSchema),
});

export type SavedViewShareList = z.infer<typeof savedViewShareListSchema>;

/**
 * A shared view, as whoever opened it sees it.
 *
 * The specification comes through so their client can render what the view is
 * about. The title and the owner appear only if the sender said they should,
 * and their absence is indistinguishable from a share that had none to give.
 *
 * What never comes through is the sender's history: opening this derives for the
 * reader, so two people following one link see different Moments and neither
 * learns what the other saw.
 */
export const sharedViewSchema = z.object({
  view: viewSpecificationSchema,
  title: savedViewTitleSchema.optional(),
  owner: publicUserSchema.optional(),
});

export type SharedView = z.infer<typeof sharedViewSchema>;
