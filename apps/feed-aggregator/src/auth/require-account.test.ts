import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { OnboardingRequiredError, UnauthenticatedError } from "../errors/aggregator-error.js";
import { ANONYMOUS, type Viewer } from "./auth-context.js";
import { accountFor } from "./require-account.js";

/**
 * Who may read history.
 *
 * Three states, three answers, and the two refusals must stay distinguishable.
 * A client that cannot tell "sign in" from "finish signing up" sends somebody
 * who has already signed in back to the sign-in screen, where nothing they do
 * will help.
 */

const signedIn = (userId: string | undefined): Viewer => ({
  kind: "authenticated",
  identityId: randomUUID(),
  sessionId: randomUUID(),
  userId,
});

describe("accountFor", () => {
  it("answers with the account when there is one", () => {
    const userId = randomUUID();

    assert.equal(accountFor(signedIn(userId)), userId);
  });

  it("refuses a reader who offered no credential", () => {
    // Anonymous is a real state rather than a failure — it is simply one that
    // reads nothing. `moments.md:589`: every read requires a Viewer, public
    // Moments included, so that signing out cannot route around a Block.
    assert.throws(() => accountFor(ANONYMOUS), UnauthenticatedError);
  });

  it("refuses somebody signed in who has not finished creating an account", () => {
    assert.throws(() => accountFor(signedIn(undefined)), OnboardingRequiredError);
  });

  it("tells the two refusals apart", () => {
    // The reason this is one function rather than a truthiness check. Both are
    // refusals; only one of them is fixed by signing in again, and the tempting
    // shortcut — no userId, so no account, so anonymous — misdirects the person
    // who did everything right.
    const anonymous = refusalFrom(() => accountFor(ANONYMOUS));
    const unonboarded = refusalFrom(() => accountFor(signedIn(undefined)));

    assert.equal(anonymous.code, "AUTHENTICATION_FAILED");
    assert.equal(anonymous.status, 401);
    assert.equal(unonboarded.code, "ONBOARDING_REQUIRED");
    assert.equal(unonboarded.status, 403);
    assert.notEqual(anonymous.message, unonboarded.message);
  });
});

/**
 * The refusal a call produced.
 *
 * @param call - Something expected to throw an aggregator error.
 * @returns Its code, status and message.
 * @throws {Error} If the call did not throw, or threw something else.
 */
function refusalFrom(call: () => unknown): { code: string; status: number; message: string } {
  try {
    call();
  } catch (error) {
    assert.ok(error instanceof UnauthenticatedError || error instanceof OnboardingRequiredError);
    return { code: error.code, status: error.status, message: error.message };
  }

  return assert.fail("expected the read to be refused");
}
