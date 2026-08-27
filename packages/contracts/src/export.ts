import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";

/**
 * Data export boundary contracts.
 *
 * An export is prepared rather than returned. A Moment may hold an unlimited
 * number of images and videos (`product/privacy.md:784`), so a history can run
 * to gigabytes — which makes a response body the wrong shape and a manifest the
 * right one.
 *
 * What crosses this boundary is therefore a description of where the parts are,
 * not the parts themselves. Every URL in it is signed when it is asked for and
 * lives for minutes, because `architecture/security.md:1776` requires
 * short-lived download access and a link signed at preparation time would still
 * work days later.
 */

/** How far along a prepared export is. */
export const exportStateSchema = z.enum([
  /** Being prepared, or waiting to be retried. */
  "pending",
  /** Prepared, and available until it expires. */
  "ready",
  /** Refused in a way that trying again cannot fix. */
  "failed",
  /** Given up on after repeated failures. */
  "abandoned",
  /** Prepared once, and no longer available. */
  "expired",
]);

export type ExportState = z.infer<typeof exportStateSchema>;

/** One file of exported data. */
export const exportPartSchema = z.object({
  name: z.string(),
  /** Signed when this manifest was built, and short-lived. */
  url: z.string(),
});

export type ExportPart = z.infer<typeof exportPartSchema>;

/**
 * One file that belonged to a Moment.
 *
 * The bytes are the originals rather than copies. Nothing is duplicated to
 * prepare an export, which keeps the only new copy of somebody's history down
 * to the data itself.
 */
export const exportMediaSchema = z.object({
  uploadId: identifierSchema,
  kind: z.string(),
  contentType: z.string().nullable(),
  byteSize: z.number().int().min(0).nullable(),
  /** Signed when this manifest was built, and short-lived. */
  url: z.string(),
});

export type ExportMedia = z.infer<typeof exportMediaSchema>;

/**
 * Where everything is.
 *
 * Present only while an export is ready. Built fresh on every request, so the
 * URLs in one manifest are not the URLs in the next and neither outlives the
 * few minutes it was signed for.
 */
export const exportManifestSchema = z.object({
  preparedAt: timestampSchema,
  expiresAt: timestampSchema,
  parts: z.array(exportPartSchema),
  media: z.array(exportMediaSchema),
});

export type ExportManifest = z.infer<typeof exportManifestSchema>;

/** How a prepared export is doing. */
export const exportStatusSchema = z.object({
  state: exportStateSchema,
  requestedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  expiresAt: timestampSchema.nullable(),
  /** Present only when the state is `ready`. */
  manifest: exportManifestSchema.optional(),
});

export type ExportStatus = z.infer<typeof exportStatusSchema>;

/** Confirming that an export should be prepared. */
export const confirmExportRequestSchema = z.object({
  token: z.string().min(1).max(512),
});

export type ConfirmExportRequest = z.infer<typeof confirmExportRequestSchema>;
