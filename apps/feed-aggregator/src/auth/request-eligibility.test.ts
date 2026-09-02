import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type {
  TimelineEligibility,
  TimelineEligibilityResolver,
  TimelineScopeRef,
} from "@chronologity/timeline-derivation";
import { describe, it } from "vitest";
import { OnboardingRequiredError, UnauthenticatedError } from "../errors/aggregator-error.js";
import { ANONYMOUS, type Viewer } from "./auth-context.js";
import { RequestEligibility } from "./request-eligibility.js";

/**
 * Resolving what a Viewer may see, once per scope.
 *
 * The property worth protecting is not speed. It is that one response cannot
 * contain two different answers to "what may this person see" — which is what
 * would happen if a Block landed between two reads of the same scope while the
 * response was being composed.
 */

const USER = randomUUID();

// No default for `userId`: passing `undefined` to a defaulted parameter uses
// the default, so a helper written that way silently hands back an onboarded
// Viewer when a test asks for the opposite. It did, and this test caught it.
const signedIn = (userId: string | undefined): Viewer => ({
  kind: "authenticated",
  identityId: randomUUID(),
  sessionId: randomUUID(),
  userId,
});

/** Somebody signed in with an account. */
const onboarded = (): Viewer => signedIn(USER);

/** Somebody signed in who has not finished creating one. */
const unonboarded = (): Viewer => signedIn(undefined);

const PLACE: TimelineScopeRef = { type: "location", id: randomUUID() };
const PERSON: TimelineScopeRef = { type: "person", id: randomUUID() };

const eligibility = (viewerUserId: string): TimelineEligibility => ({
  viewerUserId,
  blocked: [],
  audience: [],
  isAdult: true,
  scopeIsOpen: true,
});

/** A resolver that counts what it was asked, and answers however the test said. */
const resolverThat = (
  answer: (userId: string, scope: TimelineScopeRef) => Promise<TimelineEligibility>,
): TimelineEligibilityResolver & { asked: TimelineScopeRef[] } => {
  const asked: TimelineScopeRef[] = [];

  return {
    asked,
    resolve: async (userId: string, scope: TimelineScopeRef) => {
      asked.push(scope);
      return answer(userId, scope);
    },
  } as unknown as TimelineEligibilityResolver & { asked: TimelineScopeRef[] };
};

const resolving = () => resolverThat(async (userId) => eligibility(userId));

describe("RequestEligibility", () => {
  it("resolves for the account the request established", async () => {
    const resolver = resolving();

    const resolved = await new RequestEligibility(resolver, onboarded()).forScope(PLACE);

    assert.equal(resolved.viewerUserId, USER);
    assert.deepEqual(resolver.asked, [PLACE]);
  });

  it("asks once for a scope however many times it is read", async () => {
    const resolver = resolving();
    const request = new RequestEligibility(resolver, onboarded());

    const first = await request.forScope(PLACE);
    const second = await request.forScope(PLACE);

    assert.equal(first, second, "the same scope resolved twice within one request");
    assert.equal(resolver.asked.length, 1);
  });

  it("gives one answer to two readers asking at the same time", async () => {
    // The case the memo exists for: without storing the promise before it
    // settles, both would start their own resolution and could disagree.
    const resolver = resolving();
    const request = new RequestEligibility(resolver, onboarded());

    const [first, second] = await Promise.all([request.forScope(PLACE), request.forScope(PLACE)]);

    assert.equal(first, second);
    assert.equal(resolver.asked.length, 1);
  });

  it("resolves each scope separately", async () => {
    // Eligibility is scope-dependent — the audience list is bounded by the
    // scope it was gathered for — so one answer cannot serve another place.
    const resolver = resolving();
    const request = new RequestEligibility(resolver, onboarded());

    await request.forScope(PLACE);
    await request.forScope(PERSON);

    assert.deepEqual(resolver.asked, [PLACE, PERSON]);
  });

  it("does not remember a failure as an answer", async () => {
    // A transient database error must not be replayed to every later reader of
    // the scope, turning one failed lookup into an uncomposable response.
    let attempts = 0;
    const resolver = resolverThat(async (userId) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("connection terminated");
      }
      return eligibility(userId);
    });
    const request = new RequestEligibility(resolver, onboarded());

    await assert.rejects(() => request.forScope(PLACE), /connection terminated/);
    const second = await request.forScope(PLACE);

    assert.equal(second.viewerUserId, USER);
    assert.equal(attempts, 2);
  });

  it("refuses a reader with no account before asking anything", async () => {
    const resolver = resolving();

    await assert.rejects(
      () => new RequestEligibility(resolver, ANONYMOUS).forScope(PLACE),
      UnauthenticatedError,
    );
    assert.deepEqual(resolver.asked, [], "a refused request still queried the database");
  });

  it("refuses a reader who has not finished creating an account", async () => {
    const resolver = resolving();

    await assert.rejects(
      () => new RequestEligibility(resolver, unonboarded()).forScope(PLACE),
      OnboardingRequiredError,
    );
    assert.deepEqual(resolver.asked, []);
  });

  it("refuses identically however often it is asked", async () => {
    // A refusal is not an answer either, so it is not memoised as one.
    const request = new RequestEligibility(resolving(), ANONYMOUS);

    await assert.rejects(() => request.forScope(PLACE), UnauthenticatedError);
    await assert.rejects(() => request.forScope(PLACE), UnauthenticatedError);
  });
});
