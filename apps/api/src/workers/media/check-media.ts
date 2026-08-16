import { uploadReceivedPayloadSchema } from "@chronologity/contracts";
import { checkUpload } from "../../features/uploads/commands/check-upload.command.js";
import { handleCheckUpload } from "../../features/uploads/commands/check-upload.handler.js";
import type { UploadDependencies } from "../../features/uploads/dependencies.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import { generateTraceId } from "../../lib/ids/generate-trace-id.js";
import { systemContext } from "../../types/request-context.js";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * Handling one note about an arrived file.
 *
 * Kept apart from the process that runs it so it can be called directly by a
 * test, without a broker in the way.
 */

/**
 * Examine the upload a message refers to.
 *
 * Throwing means "try again": the queue will redeliver, and after enough
 * attempts set the message aside. Returning means the message is done with,
 * whether the file was accepted or refused — a refusal is a completed check,
 * not a failure to check.
 *
 * @param deps - What the Uploads feature needs, including the decoder.
 * @param event - The consumed message.
 * @param logger - Optional. Outcomes are logged with the upload's identifier;
 *   the storage key is not, since it is infrastructure detail.
 * @returns Nothing.
 * @throws {Error} If the file could not be examined and the attempt is worth
 *   repeating — storage unreachable, the decoder unavailable.
 */
export async function checkArrivedMedia(
  deps: UploadDependencies,
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

  // Correlation carries across the hop, so a trace that began with someone
  // pressing upload continues into work that happens minutes later.
  const context = systemContext(
    event.envelope.correlationId ?? generateTraceId(),
    new Date(event.envelope.occurredAt),
  );

  try {
    const accepted = await handleCheckUpload(deps, checkUpload(uploadId), context);

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
