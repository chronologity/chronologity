import { OnboardingRequiredError, UnauthenticatedError } from "../errors/aggregator-error.js";
import type { Viewer } from "./auth-context.js";

/**
 * Whose history this request may be answered for.
 *
 * Reading history requires an account. `moments.md:589` settles it — "every
 * read requires a Viewer, public Moments included" — and gives the reason: a
 * Block is between two accounts, so somebody who had been blocked could sign
 * out and read the public Moments the Block was hiding. Requiring an account
 * closes that by construction rather than by a rule somebody has to remember.
 *
 * One function rather than a check at each call site, and it takes the Viewer
 * union rather than a `userId`, so a caller cannot reach eligibility without
 * passing through here. The three states are exhaustive and TypeScript knows
 * it: adding a fourth would fail to compile rather than fall through to a
 * default that granted something.
 *
 * @param viewer - Who the request established, or that it established nobody.
 * @returns The account to resolve eligibility for.
 * @throws {UnauthenticatedError} If no credential was offered. The Viewer is
 *   anonymous, which is a real state — it is simply one that reads nothing.
 * @throws {OnboardingRequiredError} If somebody is signed in but has not
 *   finished creating an account. Distinguishable on purpose: telling them they
 *   are not authenticated would send them to sign in, which they have done.
 */
export function accountFor(viewer: Viewer): string {
  if (viewer.kind === "anonymous") {
    throw new UnauthenticatedError("Sign in to read history");
  }

  if (viewer.userId === undefined) {
    throw new OnboardingRequiredError("Finish creating your account to read history");
  }

  return viewer.userId;
}
