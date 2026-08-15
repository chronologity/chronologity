import type { ErrorCode } from "@chronologity/contracts";
import { DomainError } from "./domain-error.js";

/**
 * The caller is authenticated but has not finished creating an account.
 *
 * A distinct error rather than a plain refusal, because the client's response
 * is specific and different from every other 4xx here: send them to onboarding,
 * not to sign in again. Telling them "unauthorized" would send them back to a
 * sign-in screen they have already completed.
 */
export class OnboardingRequiredError extends DomainError {
  override readonly code: ErrorCode = "ONBOARDING_REQUIRED";
  override readonly status = 403;
}
