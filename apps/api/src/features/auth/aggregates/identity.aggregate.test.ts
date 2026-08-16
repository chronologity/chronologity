import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  decideAddEmail,
  decideCreateIdentity,
  decideVerifyEmail,
  evolveIdentity,
  hasVerifiedEmail,
  initialIdentityState,
  normalizeEmail,
  type IdentityEvent,
  type IdentityState,
} from "./identity.aggregate.js";

const identityId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-08-15T12:00:00.000Z");

const replay = (events: readonly IdentityEvent[]): IdentityState =>
  events.reduce(evolveIdentity, initialIdentityState);

const createdEvents = (email = "Person@Example.com"): readonly IdentityEvent[] => {
  const decision = decideCreateIdentity(initialIdentityState, {
    identityId,
    email,
    emailVerified: true,
    now,
  });
  return decision.ok ? decision.events : [];
};

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeEmail("  Person@Example.COM "), "person@example.com");
  });

  it("does not strip dots or plus addressing", () => {
    // Those rules are provider-specific. Applying them universally silently
    // merges addresses belonging to different people.
    assert.equal(normalizeEmail("first.last+tag@example.com"), "first.last+tag@example.com");
  });
});

describe("decideCreateIdentity", () => {
  it("creates the identity with its first email already verified", () => {
    // Redeeming a link is proof of control, so asking for confirmation again
    // would be asking someone to prove what they just proved.
    const decision = decideCreateIdentity(initialIdentityState, {
      identityId,
      email: "person@example.com",
      emailVerified: true,
      now,
    });

    assert.equal(decision.ok, true);
    assert.deepEqual(decision.ok ? decision.events.map((event) => event.type) : [], [
      "IdentityCreated",
      "EmailAdded",
      "EmailVerified",
    ]);
  });

  it("refuses to recreate an existing identity", () => {
    const decision = decideCreateIdentity(replay(createdEvents()), {
      identityId,
      email: "person@example.com",
      emailVerified: true,
      now,
    });

    assert.equal(decision.ok === false && decision.reason, "identity_already_exists");
  });
});

describe("identity state", () => {
  it("records a verified email against its normalized form", () => {
    const state = replay(createdEvents("Person@Example.com"));

    assert.equal(hasVerifiedEmail(state, "person@example.com"), true);
    assert.equal(hasVerifiedEmail(state, "someone.else@example.com"), false);
    assert.equal(state.emails[0]?.email, "Person@Example.com", "the address is preserved as given");
  });

  it("ignores a duplicate EmailAdded", () => {
    const state = replay([
      ...createdEvents(),
      {
        type: "EmailAdded",
        payload: { email: "Person@Example.com", normalizedEmail: "person@example.com" },
      },
    ]);

    assert.equal(state.emails.length, 1);
  });

  it("ignores event types it does not recognise", () => {
    const state = replay([
      ...createdEvents(),
      { type: "FromTheFuture", payload: {} } as unknown as IdentityEvent,
    ]);

    assert.equal(state.exists, true);
  });
});

describe("decideAddEmail", () => {
  it("adds a further address, unverified", () => {
    const decision = decideAddEmail(replay(createdEvents()), { email: "other@example.com" });

    assert.equal(decision.ok, true);
    assert.equal(decision.ok && decision.events[0]?.type, "EmailAdded");
  });

  it("refuses an address already on the identity", () => {
    const decision = decideAddEmail(replay(createdEvents("person@example.com")), {
      email: "PERSON@example.com",
    });

    assert.equal(decision.ok === false && decision.reason, "email_already_added");
  });

  it("refuses when the identity does not exist", () => {
    const decision = decideAddEmail(initialIdentityState, { email: "person@example.com" });
    assert.equal(decision.ok === false && decision.reason, "identity_not_found");
  });
});

describe("decideVerifyEmail", () => {
  it("verifies an added address", () => {
    const state = replay([
      ...createdEvents("first@example.com"),
      {
        type: "EmailAdded",
        payload: { email: "second@example.com", normalizedEmail: "second@example.com" },
      },
    ]);

    const decision = decideVerifyEmail(state, { email: "second@example.com", now });

    assert.equal(decision.ok, true);
    assert.equal(decision.ok && decision.events[0]?.type, "EmailVerified");
  });

  it("refuses an address the identity has not claimed", () => {
    const decision = decideVerifyEmail(replay(createdEvents()), {
      email: "stranger@example.com",
      now,
    });

    assert.equal(decision.ok === false && decision.reason, "email_not_found");
  });

  it("refuses to verify twice", () => {
    const decision = decideVerifyEmail(replay(createdEvents("person@example.com")), {
      email: "person@example.com",
      now,
    });

    assert.equal(decision.ok === false && decision.reason, "email_already_verified");
  });

  it("refuses when the identity does not exist", () => {
    const decision = decideVerifyEmail(initialIdentityState, { email: "person@example.com", now });
    assert.equal(decision.ok === false && decision.reason, "identity_not_found");
  });
});
