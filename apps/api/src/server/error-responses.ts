import { errorResponseSchema } from "@chronologity/contracts";

/**
 * The error responses a route may return, for the specification.
 *
 * Every error at every status is the same envelope
 * (`packages/contracts/src/errors.ts`), so the only thing that varies is the
 * description. That makes this a lookup rather than a schema per status, and it
 * means the sentence a client most needs to read is written once instead of
 * forty times.
 *
 * **This is not only documentation.** Fastify uses response schemas to
 * serialise, so declaring these routes every error through the serialiser
 * rather than sending the error handler's object untouched. The shape is the
 * same either way — both descend from `errorResponseSchema` — which is a claim
 * the integration tests check rather than assume.
 */

/** The statuses `to-error-response.ts` actually produces. */
export type ErrorStatus = 400 | 401 | 403 | 404 | 413 | 415 | 429 | 500;

/**
 * Always included, because every route can produce them.
 *
 * Rate limiting is registered with `global: true`, so any route may answer 429;
 * anything may fail unexpectedly. Declaring these by hand on eighty-one routes
 * would be ceremony.
 */
const ALWAYS: readonly ErrorStatus[] = [429, 500];

const DESCRIBED: Readonly<Record<ErrorStatus, ReturnType<typeof errorResponseSchema.describe>>> = {
  400: errorResponseSchema.describe(
    "The request failed validation. `details` names the field where it can.",
  ),
  401: errorResponseSchema.describe(
    "Authentication is required, or the session can no longer authenticate a request.",
  ),
  403: errorResponseSchema.describe(
    "Authenticated, but not permitted. `ONBOARDING_REQUIRED` means the caller has an Identity but has not finished creating an account, and should be sent to onboarding rather than to sign in again.",
  ),
  404: errorResponseSchema.describe(
    "No such thing — or it exists and is not for you. These are deliberately indistinguishable, so a 404 must never be read as proof that something does not exist. A Moment you may not see, an account that has blocked you, and an identifier nobody holds all answer this way.",
  ),
  413: errorResponseSchema.describe("The payload is larger than this endpoint accepts."),
  415: errorResponseSchema.describe("The content type is not one this endpoint accepts."),
  429: errorResponseSchema.describe(
    "Too many requests. The response says nothing about how many remain, since that would say how hard to push.",
  ),
  500: errorResponseSchema.describe(
    "Something failed unexpectedly. `traceId` identifies it in the logs; nothing about the failure itself reaches the caller.",
  ),
};

/**
 * Build the error half of a route's response map.
 *
 * @param statuses - What this route can refuse with, beyond the universal ones.
 *   Listed explicitly so a route never claims a refusal it cannot produce — a
 *   health check has no 401 to give.
 * @returns The response entries, ready to spread alongside the success schema.
 */
export function errors(
  ...statuses: readonly ErrorStatus[]
): Record<number, (typeof DESCRIBED)[ErrorStatus]> {
  const wanted = [...new Set([...statuses, ...ALWAYS])].sort((one, other) => one - other);

  return Object.fromEntries(wanted.map((status) => [status, DESCRIBED[status]]));
}
