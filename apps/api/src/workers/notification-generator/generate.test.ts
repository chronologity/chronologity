import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { registeredEvent } from "@chronologity/contracts";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import { NOTIFICATION_GENERATOR_EVENTS, candidateFrom } from "./generate.js";

const message = (eventType: string, payload: unknown): ConsumedEvent => ({
  topic: "chronologity.domain-reactions.v1",
  partition: 0,
  offset: "0",
  envelope: {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    aggregate: { type: "thing", id: randomUUID(), version: 1 },
    payload,
  },
});

/**
 * What each handled event should produce, and which payload field names the
 * person who hears about it.
 *
 * Written out rather than derived, because "whom does this concern" is the one
 * thing a derivation would get wrong quietly.
 */
const EXPECTED: Readonly<Record<string, { type: string; recipient: string }>> = {
  MomentReacted: { type: "moment_reacted", recipient: "authorUserId" },
  CommentReacted: { type: "comment_reacted", recipient: "authorUserId" },
  MomentCommented: { type: "moment_commented", recipient: "momentAuthorUserId" },
  CommentReplied: { type: "comment_replied", recipient: "inReplyToAuthorUserId" },
  CommentMentioned: { type: "comment_mentioned", recipient: "mentionedUserId" },
  UserFollowed: { type: "user_followed", recipient: "followedUserId" },
  // The proposal goes to the person named; the three answers go back to the
  // creator, who is the Moment's author and therefore who proposed.
  ParticipationProposed: { type: "participation_proposed", recipient: "userId" },
  ParticipationAccepted: { type: "participation_accepted", recipient: "proposedByUserId" },
  ParticipationRejected: { type: "participation_rejected", recipient: "proposedByUserId" },
  ParticipationWithdrawn: { type: "participation_withdrawn", recipient: "proposedByUserId" },
  FollowRequested: { type: "follow_requested", recipient: "followedUserId" },
  FollowRequestAccepted: { type: "follow_request_accepted", recipient: "requesterUserId" },
  AccountSecurityChanged: { type: "password_changed", recipient: "userId" },
  ModerationStateChanged: { type: "content_moderated", recipient: "affectedUserId" },
};

describe("reading a message as something somebody should hear about", () => {
  it("has an expectation for everything it handles", () => {
    assert.deepEqual([...NOTIFICATION_GENERATOR_EVENTS].sort(), Object.keys(EXPECTED).sort());
  });

  for (const eventType of NOTIFICATION_GENERATOR_EVENTS) {
    it(`tells the right person about ${eventType}`, () => {
      const example = registeredEvent(eventType)!.example;
      const expected = EXPECTED[eventType]!;

      const candidate = candidateFrom(message(eventType, example));

      assert.equal(candidate?.type, expected.type);
      assert.equal(candidate?.subjectUserId, example[expected.recipient]);
    });

    it(`refuses ${eventType} with the recipient missing`, () => {
      const example = { ...registeredEvent(eventType)!.example };
      delete example[EXPECTED[eventType]!.recipient];

      assert.equal(candidateFrom(message(eventType, example)), undefined);
    });
  }

  it("ignores an event type it was never taught", () => {
    assert.equal(candidateFrom(message("SomethingElseHappened", { actorUserId: randomUUID() })), undefined);
  });
});

describe("who is named as the actor", () => {
  it("names the person who acted, for everything somebody did to somebody else", () => {
    const example = registeredEvent("MomentReacted")!.example;

    assert.equal(candidateFrom(message("MomentReacted", example))?.actorUserId, example.actorUserId);
  });

  it("names nobody for a security change, because a takeover is exactly what cannot be attributed", () => {
    const example = registeredEvent("AccountSecurityChanged")!.example;

    assert.equal(candidateFrom(message("AccountSecurityChanged", example))?.actorUserId, undefined);
  });

  it("names nobody for a moderation decision, so a reviewer is never disclosed", () => {
    const example = registeredEvent("ModerationStateChanged")!.example;

    assert.equal(candidateFrom(message("ModerationStateChanged", example))?.actorUserId, undefined);
  });
});

describe("a security change with nobody to tell", () => {
  it("says nothing when the Identity has no account yet", () => {
    // Registration happens before a User exists. An ordinary outcome, not a
    // failure.
    const example = { ...registeredEvent("AccountSecurityChanged")!.example, userId: null };

    assert.equal(candidateFrom(message("AccountSecurityChanged", example)), undefined);
  });

  it("says nothing when the change itself is missing", () => {
    const example = { ...registeredEvent("AccountSecurityChanged")!.example };
    delete example.change;

    assert.equal(candidateFrom(message("AccountSecurityChanged", example)), undefined);
  });

  it("carries the change through as the notification type", () => {
    const example = { ...registeredEvent("AccountSecurityChanged")!.example, change: "sessions_revoked" };

    assert.equal(candidateFrom(message("AccountSecurityChanged", example))?.type, "sessions_revoked");
  });
});

describe("which moderation decisions reach somebody", () => {
  const moderated = (subjectType: string, over: Record<string, unknown> = {}) =>
    message("ModerationStateChanged", {
      ...registeredEvent("ModerationStateChanged")!.example,
      subjectType,
      ...over,
    });

  it("tells somebody their Moment was acted on", () => {
    assert.equal(candidateFrom(moderated("moment"))?.sourceType, "moment");
  });

  it("tells somebody their comment was acted on", () => {
    assert.equal(candidateFrom(moderated("comment"))?.sourceType, "comment");
  });

  it("says nothing about an account, which hears through its own history", () => {
    assert.equal(candidateFrom(moderated("user")), undefined);
  });

  it("says nothing about a medium", () => {
    assert.equal(candidateFrom(moderated("media")), undefined);
  });

  it("says nothing when nobody is recorded as affected", () => {
    assert.equal(candidateFrom(moderated("moment", { affectedUserId: null })), undefined);
  });
});
