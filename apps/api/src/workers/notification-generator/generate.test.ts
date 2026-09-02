import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { registeredEvent } from "@chronologity/contracts";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import { NOTIFICATION_GENERATOR_EVENTS, candidateFrom, notifyFromEvent } from "./generate.js";

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

/**
 * The one handled message that names no single recipient.
 *
 * A Moment arriving somewhere concerns however many people follow the places it
 * arrived at, so it takes the fan-out path rather than producing one candidate.
 * Named here rather than filtered silently, so that a *second* such message
 * cannot be added without somebody deciding it belongs on this list.
 */
const FANS_OUT: readonly string[] = ["MomentRecorded"];

const ADDRESSED = NOTIFICATION_GENERATOR_EVENTS.filter((type) => !FANS_OUT.includes(type));

describe("reading a message as something somebody should hear about", () => {
  it("has an expectation for everything it handles", () => {
    assert.deepEqual(
      [...ADDRESSED, ...FANS_OUT].sort(),
      [...NOTIFICATION_GENERATOR_EVENTS].sort(),
      "a handled message is neither addressed to somebody nor fanned out",
    );
    assert.deepEqual([...ADDRESSED].sort(), Object.keys(EXPECTED).sort());
  });

  it("produces no candidate for the message that fans out", () => {
    // It has no single recipient to name, so reading it as one would be reading
    // it wrongly. `notifyFromEvent` routes it before this is ever consulted.
    for (const eventType of FANS_OUT) {
      const example = registeredEvent(eventType)!.example;

      assert.equal(candidateFrom(message(eventType, example)), undefined, eventType);
    }
  });

  for (const eventType of ADDRESSED) {
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

describe("telling followers a place has more in it", () => {
  const PLACE = randomUUID();
  const AUTHOR = randomUUID();
  const MOMENT = randomUUID();

  /** A generator that records what it was asked to consider. */
  const recording = () => {
    const considered: { type: string; subjectUserId: string; sourceId: string }[] = [];

    return {
      considered,
      generator: {
        consider: async (candidate: {
          type: string;
          subjectUserId: string;
          sourceId: string;
        }) => {
          considered.push(candidate);

          return "notified" as const;
        },
      },
    };
  };

  const recorded = () =>
    message("MomentRecorded", { momentId: MOMENT, authorUserId: AUTHOR });

  it("tells everybody following the place", async () => {
    const { considered, generator } = recording();
    const followers = [randomUUID(), randomUUID()];

    await notifyFromEvent(generator as never, recorded(), undefined, {
      contextsOf: async () => [{ type: "location", id: PLACE }],
      followersOf: async (_context, _limit, after) => (after === undefined ? followers : []),
    });

    assert.deepEqual(
      considered.map((candidate) => candidate.subjectUserId).sort(),
      [...followers].sort(),
    );
    assert.ok(considered.every((candidate) => candidate.type === "location_expanded"));
  });

  it("points at the place rather than the Moment", async () => {
    // So that everything arriving there folds into one unread entry. Pointing
    // at the Moment would give a busy Location one notification per photograph.
    const { considered, generator } = recording();

    await notifyFromEvent(generator as never, recorded(), undefined, {
      contextsOf: async () => [{ type: "location", id: PLACE }],
      followersOf: async (_context, _limit, after) =>
        after === undefined ? [randomUUID()] : [],
    });

    assert.equal(considered[0]?.sourceId, PLACE);
  });

  it("does not tell the author about their own Moment", async () => {
    const { considered, generator } = recording();

    await notifyFromEvent(generator as never, recorded(), undefined, {
      contextsOf: async () => [{ type: "location", id: PLACE }],
      followersOf: async (_context, _limit, after) => (after === undefined ? [AUTHOR] : []),
    });

    assert.deepEqual(considered, []);
  });

  it("walks a place with more followers than one page holds", async () => {
    // A well-known Location could be followed by everybody, and gathering that
    // list to notify it would hold the whole thing for the duration.
    const { considered, generator } = recording();
    const everybody: string[] = Array.from({ length: 450 }, () => randomUUID() as string).sort();
    const pages: number[] = [];

    await notifyFromEvent(generator as never, recorded(), undefined, {
      contextsOf: async () => [{ type: "location", id: PLACE }],
      followersOf: async (_context, limit, after) => {
        const from = after === undefined ? 0 : everybody.indexOf(after) + 1;
        const page = everybody.slice(from, from + limit);

        pages.push(page.length);

        return page;
      },
    });

    assert.equal(considered.length, everybody.length, "somebody following was never told");
    assert.ok(pages.length > 1, "the whole list was read at once");
  });

  it("tells followers of every place a Moment belongs to", async () => {
    const { considered, generator } = recording();
    const occasion = randomUUID();
    const follower = randomUUID();

    await notifyFromEvent(generator as never, recorded(), undefined, {
      contextsOf: async () => [
        { type: "location", id: PLACE },
        { type: "real_world_event", id: occasion },
      ],
      followersOf: async (_context, _limit, after) =>
        after === undefined ? [follower] : [],
    });

    assert.deepEqual(considered.map((candidate) => candidate.type).sort(), [
      "location_expanded",
      "real_world_event_expanded",
    ]);
  });

  it("says nothing about a Moment belonging nowhere", async () => {
    const { considered, generator } = recording();

    await notifyFromEvent(generator as never, recorded(), undefined, {
      contextsOf: async () => [],
      followersOf: async () => [],
    });

    assert.deepEqual(considered, []);
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
