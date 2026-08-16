import type { MediaKind } from "@chronologity/contracts";
import type { UploadChecked } from "../events/upload-checked.event.js";
import type { UploadDeleted } from "../events/upload-deleted.event.js";
import type { UploadFailed } from "../events/upload-failed.event.js";
import type { UploadReceived } from "../events/upload-received.event.js";
import type { UploadRegistered } from "../events/upload-registered.event.js";

/**
 * Upload — media on its way in.
 *
 * The aggregate owns the lifecycle: authorised, arrived, refused, removed. It
 * does not own the bytes, but it does remember where they were put: an
 * arrival event that could not say which object arrived would force every
 * reader to replay the stream to find out.
 *
 * An Upload belongs to a User rather than to a Moment. Media exists before
 * publication (`media.md:456`), and binding an Upload to a Moment at this
 * point would make drafts and abandonment impossible to represent.
 *
 * Arrival and readiness are deliberately different states. `received` means
 * the bytes are there and their size was checked; `ready` means the file was
 * opened and is what it claimed to be. Nothing should attach media to anything
 * until `ready`, or a Moment could reference a file nobody has looked at.
 */

export const UPLOAD_CATEGORY = "upload";

export type UploadStatus = "registered" | "received" | "ready" | "failed" | "deleted";

export interface UploadState {
  readonly exists: boolean;
  readonly uploadId: string | undefined;
  /** Who registered it. Nobody else may finalize, read, or delete it. */
  readonly ownerUserId: string | undefined;
  readonly kind: MediaKind | undefined;
  readonly declaredContentType: string | undefined;
  readonly declaredByteSize: number | undefined;
  /** Where the bytes were put. Established at registration and never changes. */
  readonly storageKey: string | undefined;
  readonly status: UploadStatus;
  /** After this instant a registration can no longer be finalized. */
  readonly expiresAt: string | undefined;
}

export type UploadEvent =
  UploadRegistered | UploadReceived | UploadChecked | UploadFailed | UploadDeleted;

export const initialUploadState: UploadState = {
  exists: false,
  uploadId: undefined,
  ownerUserId: undefined,
  kind: undefined,
  declaredContentType: undefined,
  declaredByteSize: undefined,
  storageKey: undefined,
  status: "registered",
  expiresAt: undefined,
};

/**
 * Rebuild Upload state from its history.
 *
 * Pure, so replay is deterministic.
 *
 * @param state - State so far.
 * @param event - The next event.
 * @returns The state after applying it; unrecognised types leave it unchanged.
 */
export function evolveUpload(state: UploadState, event: UploadEvent): UploadState {
  switch (event.type) {
    case "UploadRegistered":
      return {
        ...state,
        exists: true,
        uploadId: event.payload.uploadId,
        ownerUserId: event.payload.ownerUserId,
        kind: event.payload.kind,
        declaredContentType: event.payload.declaredContentType,
        declaredByteSize: event.payload.declaredByteSize,
        storageKey: event.payload.storageKey,
        status: "registered",
        expiresAt: event.payload.expiresAt,
      };

    case "UploadReceived":
      return { ...state, status: "received" };

    case "UploadChecked":
      // The decoder's answer replaces the uploader's claim. A file declared as
      // a photograph that turns out to be one is unremarkable; the point is
      // that from here the recorded kind is the measured one.
      return { ...state, status: "ready", kind: event.payload.kind };

    case "UploadFailed":
      return { ...state, status: "failed" };

    case "UploadDeleted":
      return { ...state, status: "deleted" };

    default:
      return state;
  }
}

export type UploadRejection =
  | "upload_already_exists"
  | "upload_not_found"
  | "not_owner"
  | "registration_expired"
  | "already_received"
  | "already_checked"
  | "not_received"
  | "already_failed"
  | "already_deleted";

export type UploadDecision =
  | { readonly ok: true; readonly events: readonly UploadEvent[] }
  | { readonly ok: false; readonly reason: UploadRejection };

/**
 * Authorise an upload.
 *
 * @param state - Must be the initial state.
 * @param input - The new identifier, its owner, the media kind, what the client
 *   says it will send, when the registration lapses, and the current instant.
 * @returns The event to append, or a refusal.
 */
export function decideRegister(
  state: UploadState,
  input: {
    uploadId: string;
    ownerUserId: string;
    kind: MediaKind;
    declaredContentType: string;
    declaredByteSize: number;
    storageKey: string;
    expiresAt: Date;
    now: Date;
  },
): UploadDecision {
  if (state.exists) {
    return { ok: false, reason: "upload_already_exists" };
  }

  return {
    ok: true,
    events: [
      {
        type: "UploadRegistered",
        payload: {
          uploadId: input.uploadId,
          ownerUserId: input.ownerUserId,
          kind: input.kind,
          declaredContentType: input.declaredContentType,
          declaredByteSize: input.declaredByteSize,
          storageKey: input.storageKey,
          registeredAt: input.now.toISOString(),
          expiresAt: input.expiresAt.toISOString(),
        },
      },
    ],
  };
}

/**
 * Accept an upload after the server has inspected what is stored.
 *
 * The caller performs the inspection; this decides whether the Upload may
 * transition on the strength of it. Nothing here trusts the client
 * (`media.md:252`) — by the time this runs, the facts come from storage.
 *
 * @param state - The Upload's current state.
 * @param input - Who is finalizing, what storage reported, and the instant.
 * @returns The event to append, or a refusal. Finalizing an Upload already
 *   received is refused as `already_received`, which callers may treat as
 *   success: the caller asked for a state that already holds, and recording a
 *   second arrival would claim something that did not happen.
 */
export function decideFinalize(
  state: UploadState,
  input: {
    actorUserId: string;
    byteSize: number;
    contentType: string | undefined;
    checksum: string | undefined;
    now: Date;
  },
): UploadDecision {
  const guard = guardOwnership(state, input.actorUserId);

  if (guard !== undefined) {
    return guard;
  }

  if (state.status === "received") {
    return { ok: false, reason: "already_received" };
  }

  if (state.status === "failed") {
    return { ok: false, reason: "already_failed" };
  }

  // Checked here rather than only at the storage layer: a presigned URL may
  // have expired while the registration is still open, or the reverse. The
  // registration is what authorises the Upload to exist at all.
  if (state.expiresAt !== undefined && new Date(state.expiresAt) <= input.now) {
    return { ok: false, reason: "registration_expired" };
  }

  return {
    ok: true,
    events: [
      {
        type: "UploadReceived",
        payload: {
          uploadId: state.uploadId ?? "",
          ownerUserId: state.ownerUserId ?? "",
          kind: state.kind ?? "image",
          storageKey: state.storageKey ?? "",
          byteSize: input.byteSize,
          contentType: input.contentType,
          checksum: input.checksum,
          receivedAt: input.now.toISOString(),
        },
      },
    ],
  };
}

/**
 * Record that a file was opened and found acceptable.
 *
 * The judgement itself happens outside: the decoder reports, the rules decide,
 * and this records the outcome. Keeping them apart means the rules can be
 * tested without a file and this can be tested without a decoder.
 *
 * @param state - The Upload's current state.
 * @param input - What the decoder found, and the instant.
 * @returns The event to append, or a refusal. Checking an upload that never
 *   arrived is refused: there would be nothing to open. Checking one already
 *   checked is refused as `already_checked`, which callers should treat as
 *   success — at-least-once delivery means the same file will be offered
 *   twice, and that is ordinary rather than exceptional.
 */
export function decideCheck(
  state: UploadState,
  input: {
    kind: MediaKind;
    codec: string;
    container: string;
    width: number;
    height: number;
    durationSeconds: number | undefined;
    hasAudio: boolean;
    now: Date;
  },
): UploadDecision {
  if (!state.exists || state.status === "deleted") {
    return { ok: false, reason: "upload_not_found" };
  }

  if (state.status === "ready") {
    return { ok: false, reason: "already_checked" };
  }

  if (state.status === "failed") {
    return { ok: false, reason: "already_failed" };
  }

  // Nothing has arrived, so there is nothing to open. Reachable if a note is
  // delivered before the arrival it describes was recorded.
  if (state.status !== "received") {
    return { ok: false, reason: "not_received" };
  }

  return {
    ok: true,
    events: [
      {
        type: "UploadChecked",
        payload: {
          kind: input.kind,
          codec: input.codec,
          container: input.container,
          width: input.width,
          height: input.height,
          durationSeconds: input.durationSeconds,
          hasAudio: input.hasAudio,
          checkedAt: input.now.toISOString(),
        },
      },
    ],
  };
}

/**
 * Refuse an upload.
 *
 * @param state - The Upload's current state.
 * @param input - Who is failing it, why, and the instant. The reason is
 *   recorded and shown to the owner, so it must describe the media rather than
 *   the infrastructure.
 * @returns The event to append, or a refusal if the Upload is gone or already
 *   settled.
 */
export function decideFail(
  state: UploadState,
  input: {
    actorUserId: string;
    reason: string;
    category: "transient" | "permanent";
    attempt: number;
    now: Date;
  },
): UploadDecision {
  const guard = guardOwnership(state, input.actorUserId);

  if (guard !== undefined) {
    return guard;
  }

  if (state.status === "failed") {
    return { ok: false, reason: "already_failed" };
  }

  return {
    ok: true,
    events: [
      {
        type: "UploadFailed",
        payload: {
          reason: input.reason,
          category: input.category,
          attempt: input.attempt,
          failedAt: input.now.toISOString(),
        },
      },
    ],
  };
}

/**
 * Remove an upload and, by consequence, its stored object.
 *
 * @param state - The Upload's current state.
 * @param input - Who is deleting it and the instant.
 * @returns The event to append, or a refusal. Deleting an already-deleted
 *   Upload is refused rather than recorded twice; callers may treat that as
 *   success, since the object is gone either way.
 */
export function decideDelete(
  state: UploadState,
  input: { actorUserId: string; now: Date },
): UploadDecision {
  const guard = guardOwnership(state, input.actorUserId);

  if (guard !== undefined) {
    return guard;
  }

  if (state.status === "deleted") {
    return { ok: false, reason: "already_deleted" };
  }

  return {
    ok: true,
    events: [{ type: "UploadDeleted", payload: { deletedAt: input.now.toISOString() } }],
  };
}

/**
 * The checks every operation on an existing Upload shares.
 *
 * Ownership lives in the aggregate rather than in a route so that no future
 * caller can reach a transition without passing it. A deleted Upload reads as
 * absent: its owner asked for it to be gone, and reporting it as present but
 * unusable would contradict that.
 *
 * @param state - The Upload's current state.
 * @param actorUserId - Who is acting.
 * @returns A refusal, or undefined when the actor may proceed.
 */
function guardOwnership(
  state: UploadState,
  actorUserId: string,
): { readonly ok: false; readonly reason: UploadRejection } | undefined {
  if (!state.exists || state.status === "deleted") {
    return { ok: false, reason: "upload_not_found" };
  }

  if (state.ownerUserId !== actorUserId) {
    return { ok: false, reason: "not_owner" };
  }

  return undefined;
}
