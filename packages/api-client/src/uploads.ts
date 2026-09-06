import type { UploadAuthorization } from "@chronologity/contracts";
import { TransportError } from "./retry.js";

/**
 * Carrying bytes to storage.
 *
 * **The one step in this system that does not go through the API**, and
 * therefore the one step this package's `request` cannot make. Media never
 * traverses the server (ADR-029): the API authorises an upload and hands back a
 * presigned URL, the client writes straight to object storage, and the API
 * verifies afterwards. So there is a hole in the middle of the flow, and this
 * fills it.
 *
 * ```text
 * POST /uploads              → uploadUrl, contentType, two expiries
 * PUT  <uploadUrl>           ← this
 * POST /uploads/:id/finalize → the server opens what arrived
 * ```
 *
 * **No `Authorization` header, and this is the part everybody gets wrong.** The
 * signature in the URL *is* the authority. Adding a bearer token does not make
 * the request more authorised — it makes it a different request from the one
 * that was signed, and storage refuses it.
 *
 * **The content type must be exactly what was handed back.** It is covered by
 * the signature too, so `image/jpeg` where the authorisation said `image/jpg` is
 * a mismatch rather than a synonym. Passing it through from the authorisation
 * rather than letting a caller supply one removes the chance to disagree.
 *
 * **Two expiries, and they mean different things.** `uploadUrlExpiresAt` is how
 * long the signature is good for; `expiresAt` is how long the registration
 * lasts. The window to write is not the window to finish, and a client that
 * conflates them will hold a valid registration it can no longer write to.
 */

/** What a caller needs in order to send the bytes. */
export interface UploadOptions {
  /** What `POST /uploads` handed back. */
  readonly authorization: UploadAuthorization;
  /** The bytes. A `Blob` on a device, a `Uint8Array` in a test. */
  readonly body: Blob | ArrayBuffer | Uint8Array;
  /** Cancels the transfer. Uploads are long enough that somebody will. */
  readonly signal?: AbortSignal;
  /** Overrides `globalThis.fetch`. Primarily a testing seam. */
  readonly fetch?: typeof globalThis.fetch;
  /** The clock, so an expiry can be checked without waiting for one. */
  readonly now?: () => number;
}

/**
 * Write the bytes to the URL the API authorised.
 *
 * Does not finalise, and does not poll. Finalising is an API call the caller
 * makes through the ordinary client — it is documented idempotent, so it is safe
 * to retry — and polling until `ready` is a decision about how often to ask,
 * which is a UX question rather than a transport one.
 *
 * @param options - The authorisation, the bytes, and the seams.
 * @returns Nothing. Storage answers with no body worth reading; what the file
 *   turned out to be is the API's answer to `finalize`, not this one's.
 * @throws {TransportError} If the signature has already expired, if the transfer
 *   could not be made, or if storage refused it. Storage speaks XML rather than
 *   this API's envelope, so its refusals are not `ApiError`s and must not be
 *   dressed up as any — the status is reported and the body is not.
 */
export async function putUpload(options: UploadOptions): Promise<void> {
  const {
    authorization,
    body,
    signal,
    fetch: fetchImpl = globalThis.fetch,
    now = Date.now,
  } = options;

  // Checked before sending rather than after failing, because storage's refusal
  // for an expired signature is a 403 that reads exactly like a malformed one —
  // and the caller's next move differs entirely: register again, or fix a bug.
  if (new Date(authorization.uploadUrlExpiresAt).getTime() <= now()) {
    throw new TransportError(
      "The upload authorisation expired before the transfer began. Register the upload again.",
      false,
    );
  }

  let response: Response;

  try {
    response = await fetchImpl(authorization.uploadUrl, {
      method: "PUT",
      // Exactly these, and nothing else. Every header here is covered by the
      // signature; an extra one is a different request from the one signed.
      headers: { "content-type": authorization.contentType },
      body: body as NonNullable<RequestInit["body"]>,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) {
      throw new TransportError("The upload was cancelled", false, error);
    }

    throw new TransportError("The upload could not be sent", true, error);
  }

  if (!response.ok) {
    // The status and nothing more. Storage's body is XML naming the bucket and
    // the key, and neither belongs in front of somebody or in a log here.
    throw new TransportError(
      `Storage refused the upload with status ${response.status}`,
      response.status >= 500,
    );
  }
}
