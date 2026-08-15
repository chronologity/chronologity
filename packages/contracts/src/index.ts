/**
 * The public contract surface shared across Chronologity applications.
 *
 * This barrel exists because the package's public API is deliberate: consumers
 * import from `@chronologity/contracts`, not from its internal file layout.
 *
 * Contracts grow alongside implementation. Authentication, media, pagination,
 * and per-domain event payloads arrive with the phases that own them rather
 * than being invented in advance.
 */
export {
  aggregateReferenceSchema,
  brandedIdentifier,
  identifierSchema,
  type AggregateReference,
  type Identifier,
} from "./identifiers.js";
export {
  occurredAtSchema,
  occurrenceSchema,
  recordedAtSchema,
  temporalPrecisionSchema,
  timestampSchema,
  type Occurrence,
  type TemporalPrecision,
  type Timestamp,
} from "./time.js";
export {
  errorCodeSchema,
  errorResponseSchema,
  isRetryable,
  type ErrorCode,
  type ErrorResponse,
} from "./errors.js";
export {
  createSessionRequestSchema,
  passwordChangeRequestSchema,
  passwordResetCompletionSchema,
  passwordResetRequestSchema,
  passwordSignInRequestSchema,
  registrationRequestSchema,
  registrationResponseSchema,
  verifyEmailRequestSchema,
  type PasswordChangeRequest,
  type PasswordResetCompletion,
  type PasswordResetRequest,
  type PasswordSignInRequest,
  type RegistrationRequest,
  type RegistrationResponse,
  type VerifyEmailRequest,
  magicLinkRequestSchema,
  magicLinkResponseSchema,
  refreshSessionRequestSchema,
  sessionCredentialsSchema,
  sessionListSchema,
  sessionSummarySchema,
  type CreateSessionRequest,
  type MagicLinkRequest,
  type MagicLinkResponse,
  type RefreshSessionRequest,
  type SessionCredentials,
  type SessionList,
  type SessionSummary,
} from "./auth.js";
export {
  actorSchema,
  envelopeOf,
  eventEnvelopeSchema,
  type Actor,
  type EventEnvelope,
} from "./event-envelope.js";
