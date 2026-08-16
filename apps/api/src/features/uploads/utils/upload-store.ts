import { readStream } from "../../../lib/eventstore/read-stream.js";
import { streamName } from "../../../lib/eventstore/stream-name.js";
import {
  evolveUpload,
  initialUploadState,
  UPLOAD_CATEGORY,
  type UploadEvent,
  type UploadState,
} from "../aggregates/upload.aggregate.js";
import type { UploadDependencies } from "../dependencies.js";

export interface LoadedUpload {
  readonly state: UploadState;
  readonly revision: bigint | "no_stream";
}

/**
 * Load an Upload from its authoritative history.
 *
 * @param deps - Supplies the event store.
 * @param uploadId - Which Upload.
 * @returns Its state and the revision that state reflects, so a decision made
 *   from it can be appended against the same revision.
 */
export async function loadUpload(
  deps: UploadDependencies,
  uploadId: string,
): Promise<LoadedUpload> {
  const recorded = await readStream(deps.client, streamName(UPLOAD_CATEGORY, uploadId));

  let state = initialUploadState;
  for (const event of recorded) {
    state = evolveUpload(state, { type: event.type, payload: event.payload } as UploadEvent);
  }

  const last = recorded[recorded.length - 1];

  return { state, revision: last === undefined ? "no_stream" : last.revision };
}
