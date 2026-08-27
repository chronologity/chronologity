import assert from "node:assert/strict";
import type { Notification, NotificationType } from "@chronologity/contracts";
import { describe, it } from "vitest";
import { composeDigest, composeEmail, composePush } from "./notification.messages.js";

const TYPES: NotificationType[] = [
  "moment_reacted",
  "comment_reacted",
  "moment_commented",
  "comment_replied",
  "comment_mentioned",
  "user_followed",
  "follow_requested",
  "follow_request_accepted",
  "upload_ready",
  "upload_rejected",
  "content_moderated",
  "password_set",
  "password_changed",
  "phone_claimed",
  "phone_removed",
  "email_verified",
  "sessions_revoked",
];

const actor = (userId: string, handle: string, displayName: string) => ({
  userId,
  handle,
  displayName,
});

const notification = (
  type: string,
  actors: { userId: string; handle: string; displayName: string }[] = [],
  otherActors = 0,
): Notification =>
  ({
    notificationId: "n1",
    type,
    category: "social",
    source: { type: "moment", id: "m1" },
    actors,
    otherActors,
    createdAt: "2026-06-10T12:00:00.000Z",
    readAt: null,
  }) as Notification;

const ALEX = actor("u1", "alex", "Alex Mercer");
const SAM = actor("u2", "sam", "Sam Okafor");

describe("composeEmail", () => {
  it("names one person", () => {
    assert.equal(
      composeEmail(notification("moment_reacted", [ALEX]))?.body,
      "Alex Mercer reacted to your Moment.",
    );
  });

  it("names two", () => {
    assert.equal(
      composeEmail(notification("moment_commented", [ALEX, SAM]))?.body,
      "Alex Mercer and Sam Okafor commented on your Moment.",
    );
  });

  it("names two and counts the rest", () => {
    assert.equal(
      composeEmail(notification("moment_reacted", [ALEX, SAM], 4))?.body,
      "Alex Mercer, Sam Okafor and 4 others reacted to your Moment.",
    );
  });

  it("counts a single remaining person in the singular", () => {
    assert.equal(
      composeEmail(notification("moment_reacted", [ALEX], 1))?.body,
      "Alex Mercer and 1 other reacted to your Moment.",
    );
  });

  it("counts everybody when the reader may name none of them", () => {
    // Every actor is somebody suspended, or separated by a Block. They count
    // and they are not identified.
    assert.equal(
      composeEmail(notification("moment_reacted", [], 3))?.body,
      "3 people reacted to your Moment.",
    );
  });

  it("says someone when there is one person the reader may not name", () => {
    assert.equal(
      composeEmail(notification("user_followed", [], 1))?.body,
      "Someone started following you.",
    );
  });

  it("words a decision about your content without naming a moderator", () => {
    const message = composeEmail(notification("content_moderated"));

    assert.match(message?.body ?? "", /moderation decision/);
    assert.doesNotMatch(message?.body ?? "", /moderator|reviewer|reviewed by/i);
  });

  it("words a security change without saying what it changed to", () => {
    const message = composeEmail(notification("password_changed"));

    assert.equal(message?.subject, "Your password was changed");
    assert.match(message?.body ?? "", /If this was not you/);
  });
});

describe("composePush", () => {
  it("names nobody", () => {
    // The whole point of the channel being treated separately. A lock screen is
    // visible to whoever is standing nearby.
    const message = composePush(notification("moment_reacted", [ALEX, SAM], 4));

    assert.equal(message?.body, "6 people reacted to your Moment.");
  });

  it("names nobody even when there is exactly one person the reader knows", () => {
    const message = composePush(notification("moment_commented", [ALEX]));

    assert.equal(message?.body, "Someone commented on your Moment.");
  });

  it("carries no handle or display name for any type", () => {
    for (const type of TYPES) {
      const message = composePush(notification(type, [ALEX, SAM], 2));
      const text = `${message?.subject ?? ""} ${message?.body ?? ""}`;

      assert.doesNotMatch(text, /Alex Mercer|Sam Okafor|alex|sam/, type);
    }
  });

  it("says the same thing as email for something nobody did to you", () => {
    // An upload finishing involves no person, so there is nothing for push to
    // withhold and no reason for the two channels to diverge.
    for (const type of ["upload_ready", "content_moderated", "password_changed"]) {
      assert.deepEqual(composePush(notification(type)), composeEmail(notification(type)), type);
    }
  });
});

describe("wording for every type", () => {
  it("words every type on both channels", () => {
    for (const type of TYPES) {
      assert.notEqual(composeEmail(notification(type, [ALEX])), undefined, type);
      assert.notEqual(composePush(notification(type, [ALEX])), undefined, type);
    }
  });

  it("words nothing it does not recognise", () => {
    // A vocabulary grows. A delivery that threw on the first new value would
    // stall every delivery behind it.
    assert.equal(composeEmail(notification("invented_later")), undefined);
    assert.equal(composePush(notification("invented_later")), undefined);
  });

  it("carries no caption, comment, place, or Event name for any type", () => {
    // Structural rather than careful: a rendered notification has no field
    // these could come from. The assertion holds the property in place if one
    // is ever added.
    for (const type of TYPES) {
      const text = JSON.stringify([
        composeEmail(notification(type, [ALEX], 2)),
        composePush(notification(type, [ALEX], 2)),
      ]);

      assert.doesNotMatch(text, /m1|n1|u1|u2/, type);
    }
  });
});

describe("composeDigest", () => {
  it("gathers several notifications into one message", () => {
    const message = composeDigest(
      [
        notification("moment_reacted", [ALEX]),
        notification("moment_commented", [SAM]),
        notification("user_followed", [ALEX]),
      ],
      true,
    );

    assert.equal(message?.subject, "3 things happened on Chronologity");
    assert.equal(
      message?.body,
      [
        "Alex Mercer reacted to your Moment.",
        "Sam Okafor commented on your Moment.",
        "Alex Mercer started following you.",
      ].join("\n"),
    );
  });

  it("names nobody when the digest is going to a lock screen", () => {
    const message = composeDigest(
      [notification("moment_reacted", [ALEX]), notification("moment_commented", [SAM])],
      false,
    );

    assert.doesNotMatch(`${message?.subject} ${message?.body}`, /Alex Mercer|Sam Okafor/);
  });

  it("counts what it actually says rather than what it was given", () => {
    // A type nobody has wording for is dropped, and the subject must not go on
    // claiming it is there.
    const message = composeDigest(
      [notification("moment_reacted", [ALEX]), notification("invented_later", [SAM])],
      true,
    );

    assert.equal(message?.subject, "What happened on Chronologity");
    assert.equal(message?.body, "Alex Mercer reacted to your Moment.");
  });

  it("produces nothing when it can word none of them", () => {
    assert.equal(composeDigest([notification("invented_later")], true), undefined);
    assert.equal(composeDigest([], true), undefined);
  });
});
