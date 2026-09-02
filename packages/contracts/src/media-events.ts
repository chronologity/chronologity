import { z } from "zod";
import { envelopeOf } from "./event-envelope.js";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";
import { mediaKindSchema } from "./uploads.js";

/**
 * Integration events for media.
 *
 * These are promises to whoever consumes them, not copies of internal history.
 * Anything added to an Upload's own record stays private unless it is added
 * here deliberately, which is the separation ADR-014 asks for.
 *
 * Everything here is either an identifier or a claim the consumer is expected
 * to verify. Notably, `kind` is what the uploader said the file is — the whole
 * point of the consumer is to open the file and find out whether that was
 * true.
 */

/**
 * An uploaded file has arrived and needs checking.
 *
 * Carries where the bytes are, because the consumer needs to read them, and
 * who owns them, because a failure has to be reported to someone. It carries
 * no sizes, no checksums, and no timestamps beyond arrival: a consumer that
 * needs those can establish them from the file itself, which is more
 * trustworthy than being told.
 */
export const uploadReceivedPayloadSchema = z.object({
  uploadId: identifierSchema,
  ownerUserId: identifierSchema,
  /** As declared by the uploader. To be verified, not believed. */
  kind: mediaKindSchema,
  /** Where the bytes live. Infrastructure, but the consumer cannot read without it. */
  storageKey: z.string().min(1),
  receivedAt: timestampSchema,
});

export type UploadReceivedPayload = z.infer<typeof uploadReceivedPayloadSchema>;

export const uploadReceivedEventSchema = envelopeOf("UploadReceived", uploadReceivedPayloadSchema);

/** The integration boundary media events are published to. */
export const MEDIA_BOUNDARY = "media";
