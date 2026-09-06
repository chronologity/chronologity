/**
 * Typed REST client for the Chronologity API.
 *
 * The package is bootstrapped without operations on purpose. Client methods
 * are added against real, stable API routes as those routes are implemented,
 * so this package never describes endpoints that do not exist.
 *
 * What lives here is transport concern only: base URL, authentication header,
 * timeouts, and mapping the API's stable error envelope onto a thrown error.
 * Server business logic never moves into the client.
 */
export { ApiError } from "./api-error.js";
export {
  createApiClient,
  type ApiClient,
  type ApiClientOptions,
  type RequestOptions,
} from "./client.js";
