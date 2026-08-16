import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";

/**
 * Upload boundary contracts.
 *
 * An Upload is media on its way into Chronologity, and it belongs to a User
 * rather than to a Moment: media may exist before a Moment is published
 * (`media.md:456`), which is what makes drafts, retries, and abandonment
 * possible.
 *
 * Everything a client states here is a declaration, not a fact. The server
 * verifies against the stored object before an Upload becomes usable.
 */

/** The media Chronologity accepts. Anything else needs a product decision. */
export const mediaKindSchema = z.enum(["image", "video"]);

export type MediaKind = z.infer<typeof mediaKindSchema>;

/**
 * Where an Upload has got to.
 *
 * `registered` means authorised but not yet arrived; `received` means the
 * server has looked at the stored object and accepted it. The processing
 * states that sit between them arrive with the media worker.
 */
export const uploadStateSchema = z.enum(["registered", "received", "failed", "deleted"]);

export type UploadState = z.infer<typeof uploadStateSchema>;

/**
 * Asking to upload something.
 *
 * The content type and size are what the client intends to send. Both are
 * recorded as declared and checked against reality at finalization, because a
 * filename and a client header are not proof (`media.md:256`).
 */
export const registerUploadRequestSchema = z.object({
  contentType: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z]+\/[a-z0-9.+-]+$/i, "Provide a media type such as image/jpeg"),
  /** What the client expects to send. Advisory: the stored object decides. */
  declaredByteSize: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024 * 1024),
});

export type RegisterUploadRequest = z.infer<typeof registerUploadRequestSchema>;

/**
 * Permission to upload one object.
 *
 * The URL authorises a single PUT to a single server-generated key and expires
 * shortly. It is not returned again: asking twice re-registers.
 */
export const uploadAuthorizationSchema = z.object({
  uploadId: identifierSchema,
  kind: mediaKindSchema,
  uploadUrl: z.url(),
  /** The exact type to send. The signature covers it, so anything else fails. */
  contentType: z.string(),
  /** When the URL stops working. */
  uploadUrlExpiresAt: timestampSchema,
  /** When the registration itself lapses, after which it cannot be finalized. */
  expiresAt: timestampSchema,
  maximumByteSize: z.number().int().positive(),
});

export type UploadAuthorization = z.infer<typeof uploadAuthorizationSchema>;

/**
 * An Upload as its owner sees it.
 *
 * Carries no storage key and no URL. The key is infrastructure
 * (`media.md:166`), and a durable signed URL is precisely what
 * `media.md:520` says not to keep.
 */
export const uploadSchema = z.object({
  uploadId: identifierSchema,
  kind: mediaKindSchema,
  state: uploadStateSchema,
  declaredContentType: z.string(),
  declaredByteSize: z.number().int().nonnegative(),
  /** Present once the server has inspected the stored object. */
  byteSize: z.number().int().nonnegative().nullable(),
  contentType: z.string().nullable(),
  checksum: z.string().nullable(),
  /** Why an upload failed, in terms safe to show its owner. */
  failureReason: z.string().nullable(),
  registeredAt: timestampSchema,
  expiresAt: timestampSchema,
  receivedAt: timestampSchema.nullable(),
});

export type Upload = z.infer<typeof uploadSchema>;

/** Someone's own uploads, newest first. */
export const uploadListSchema = z.object({ uploads: z.array(uploadSchema) });

export type UploadList = z.infer<typeof uploadListSchema>;
