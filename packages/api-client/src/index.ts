/**
 * Typed REST client for the Chronologity API.
 *
 * Two things, kept apart on purpose.
 *
 * **Transport**: a base URL, a credential, timeouts, retries that never repeat a
 * `POST`, a session that refreshes before it expires, and the mapping from the
 * API's stable error envelope onto a thrown error.
 *
 * **Operations**: one for every route the API declares, each naming a method, a
 * path, and the contract schemas either side of it. A test reads the published
 * OpenAPI document and fails when an operation exists there with no way to call
 * it here, so the set cannot quietly fall behind (ADR-152).
 *
 * Types are never restated. They come from `packages/contracts` — the same
 * schemas that validate the request and serialise the response on the API side,
 * so an operation parses the very object that produced the bytes.
 *
 * **Server business logic never moves into the client.** Nothing here decides
 * what anybody may see; it carries messages and refuses to interpret them.
 */
export { ApiError } from "./api-error.js";
export {
  createApiClient,
  type ApiClient,
  type ApiClientOptions,
  type RequestOptions,
} from "./client.js";
export { queryString } from "./query.js";
export { createSession, type Session, type SessionOptions } from "./session.js";
export { putUpload, type UploadOptions } from "./uploads.js";
export { defaultRetryPolicy, TransportError, type RetryPolicy } from "./retry.js";

/**
 * Every operation the API declares, grouped by feature.
 *
 * `operations.moments.recordMoment(client, { body })` — the namespace says what
 * a call is at the point of making it, which a bare name among a hundred and
 * sixty-three siblings would not.
 */
export * as operations from "./operations/index.js";
