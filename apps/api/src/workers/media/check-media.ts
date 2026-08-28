import { MEDIA_BOUNDARY, uploadReceivedPayloadSchema } from "@chronologity/contracts";
import type { UploadService } from "../../features/uploads/upload.service.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * Handling one note about an arrived file.
 *
 * Kept apart from the process that runs it so it can be called directly by a
 * test, without a broker in the way.
 */

/**
 * The event types this worker knows what to do with.
 *
 * One, and it is the only thing published to the media boundary. Stated as data
 * anyway, so the same test that checks the other two workers checks this one:
 * a second media event added later and never handled here would otherwise be
 * silence rather than a failure.
 */
export const MEDIA_CHECKER_EVENTS: readonly string[] = ["UploadReceived"];

/**
 * The boundaries this worker subscribes to.
 *
 * Declared beside the handler rather than inside the process entry point, so
 * that the two can be compared. `index.ts` runs on import; a list held there is
 * a list nothing can read.
 */
export const MEDIA_CHECKER_BOUNDARIES: readonly string[] = [MEDIA_BOUNDARY];

/**
 * Examine the upload a message refers to.
 *
 * Throwing means "try again": the queue will redeliver, and after enough
 * attempts set the message aside. Returning means the message is done with,
 * whether the file was accepted or refused — a refusal is a completed check,
 * not a failure to check.
 *
 * @param uploads - The Upload service, built with a decoder.
 * @param event - The consumed message.
 * @param logger - Optional. Outcomes are logged with the upload's identifier;
 *   the storage key is not, since it is infrastructure detail.
 * @returns Nothing.
 * @throws {Error} If the file could not be examined and the attempt is worth
 *   repeating — storage unreachable, the decoder unavailable.
 */
export async function checkArrivedMedia(
  uploads: UploadService,
  event: ConsumedEvent,
  logger?: Logger,
): Promise<void> {
  const parsed = uploadReceivedPayloadSchema.safeParse(event.envelope.payload);

  if (!parsed.success) {
    // The message does not say what it claims to. Retrying cannot fix a
    // malformed payload, so it is dropped here rather than looping; the
    // consumer's dead-letter path exists for what it cannot parse at all.
    logger?.error(
      { topic: event.topic, eventId: event.envelope.eventId },
      "Ignoring a media message whose payload does not match its contract",
    );

    return;
  }

  const { uploadId } = parsed.data;

  try {
    const accepted = await uploads.check(uploadId);

    logger?.info({ uploadId, accepted }, accepted ? "Media accepted" : "Media refused");
  } catch (error) {
    // An upload deleted between arriving and being checked. Its owner asked
    // for it to be gone, so there is nothing to examine and nothing to retry.
    if (error instanceof NotFoundError) {
      logger?.info({ uploadId }, "Upload no longer exists, nothing to check");

      return;
    }

    throw error;
  }
}
