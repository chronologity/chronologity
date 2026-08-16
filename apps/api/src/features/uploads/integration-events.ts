import { MEDIA_BOUNDARY, type UploadReceivedPayload } from "@chronologity/contracts";
import type { Route } from "../../workers/event-publisher/publish-events.js";
import type { UploadReceived } from "./events/upload-received.event.js";

/**
 * What the Uploads feature publishes, and what it keeps to itself.
 *
 * Only arrival is published. Registration is an intention rather than a fact
 * about a file; failure and deletion are the API's own business until
 * something outside needs them. None of the three has a consumer, and
 * publishing without one is how internal history quietly becomes a contract.
 *
 * The translation is deliberate rather than a copy. An Upload's history holds
 * what the uploader claimed about size and content type, kept so a later
 * mismatch is answerable — not something a consumer should act on, so it does
 * not cross the boundary. What does cross is only what a processor needs:
 * which upload, whose it is, what it claims to be, and where to read it.
 */
export const uploadRoute: Route = {
  boundary: MEDIA_BOUNDARY,

  translate(event) {
    if (event.type !== "UploadReceived") {
      return undefined;
    }

    const payload = event.payload as UploadReceived["payload"];

    return {
      uploadId: payload.uploadId,
      ownerUserId: payload.ownerUserId,
      kind: payload.kind,
      storageKey: payload.storageKey,
      receivedAt: payload.receivedAt,
    } satisfies UploadReceivedPayload;
  },
};
