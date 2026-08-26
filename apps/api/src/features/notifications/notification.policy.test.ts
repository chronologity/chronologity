import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  aggregationKey,
  categoryOf,
  describeActors,
  isRequired,
  permits,
  recipientOf,
  type NotificationCategory,
  type NotificationType,
} from "./notification.policy.js";

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
];

describe("categoryOf", () => {
  it("places every type it knows", () => {
    for (const type of TYPES) {
      assert.notEqual(categoryOf(type), undefined, type);
    }
  });

  it("sorts social activity into social", () => {
    assert.equal(categoryOf("moment_reacted"), "social");
    assert.equal(categoryOf("comment_mentioned"), "social");
    assert.equal(categoryOf("user_followed"), "social");
  });

  it("sorts upload outcomes into media", () => {
    assert.equal(categoryOf("upload_ready"), "media");
    assert.equal(categoryOf("upload_rejected"), "media");
  });

  it("sorts a decision about your content into moderation", () => {
    assert.equal(categoryOf("content_moderated"), "moderation");
  });

  it("places a type it does not know nowhere", () => {
    // A topic gains event types over time. A consumer that dies on the first
    // one it has not been taught about turns an additive change into an outage.
    assert.equal(categoryOf("something_nobody_has_written_yet"), undefined);
  });
});

describe("isRequired", () => {
  it("requires moderation", () => {
    // Somebody must be told what was done to their content: an appeal against a
    // decision they were never told about is not a right they have.
    assert.equal(isRequired("moderation"), true);
  });

  it("requires nothing else", () => {
    assert.equal(isRequired("social"), false);
    assert.equal(isRequired("media"), false);
  });

  it("requires exactly one of the three", () => {
    const categories: NotificationCategory[] = ["social", "media", "moderation"];

    // Narrowly defined, as the document asks. A second required category is a
    // decision somebody should have to argue for.
    assert.equal(categories.filter(isRequired).length, 1);
  });
});

describe("permits", () => {
  it("delivers what nobody has expressed a view about", () => {
    // An opt-in default would mean a new account is told nothing at all,
    // including that its upload failed.
    assert.equal(permits("social", undefined), true);
  });

  it("delivers what somebody asked for", () => {
    assert.equal(permits("social", true), true);
  });

  it("suppresses what somebody switched off", () => {
    assert.equal(permits("social", false), false);
    assert.equal(permits("media", false), false);
  });

  it("delivers moderation whatever the preference says", () => {
    assert.equal(permits("moderation", false), true);
    assert.equal(permits("moderation", undefined), true);
  });
});

describe("recipientOf", () => {
  it("tells the subject", () => {
    assert.equal(
      recipientOf({ type: "moment_reacted", actorUserId: "alex", subjectUserId: "sam" }),
      "sam",
    );
  });

  it("tells nobody about their own activity", () => {
    // Reacting to your own Moment, replying to yourself, moderating your own
    // content: each produces nothing.
    assert.equal(
      recipientOf({ type: "moment_reacted", actorUserId: "sam", subjectUserId: "sam" }),
      undefined,
    );
  });

  it("tells nobody about a type it does not recognise", () => {
    assert.equal(
      recipientOf({ type: "invented_later", actorUserId: "alex", subjectUserId: "sam" }),
      undefined,
    );
  });

  it("finds a recipient for every type it knows", () => {
    for (const type of TYPES) {
      assert.equal(recipientOf({ type, actorUserId: "alex", subjectUserId: "sam" }), "sam", type);
    }
  });
});

describe("aggregationKey", () => {
  it("is the same for the same activity on the same thing", () => {
    assert.equal(
      aggregationKey("sam", "moment_reacted", "moment-1"),
      aggregationKey("sam", "moment_reacted", "moment-1"),
    );
  });

  it("separates two kinds of activity on one thing", () => {
    assert.notEqual(
      aggregationKey("sam", "moment_reacted", "moment-1"),
      aggregationKey("sam", "moment_commented", "moment-1"),
    );
  });

  it("separates one kind of activity on two things", () => {
    assert.notEqual(
      aggregationKey("sam", "moment_reacted", "moment-1"),
      aggregationKey("sam", "moment_reacted", "moment-2"),
    );
  });

  it("separates two people notified about the same activity", () => {
    // Two people can be mentioned in one comment. Their entries must not
    // collapse into one.
    assert.notEqual(
      aggregationKey("sam", "comment_mentioned", "comment-1"),
      aggregationKey("alex", "comment_mentioned", "comment-1"),
    );
  });

  it("carries no time component", () => {
    // The window is "until read", which read state already expresses. A key
    // carrying an hour would open a second entry for something nobody has
    // looked at yet.
    const once = aggregationKey("sam", "moment_reacted", "moment-1");

    assert.equal(once, aggregationKey("sam", "moment_reacted", "moment-1"));
    assert.equal(once.includes(String(new Date().getUTCFullYear())), false);
  });
});

describe("describeActors", () => {
  it("names one", () => {
    assert.deepEqual(describeActors(["alex"], 1), { named: ["alex"], others: 0 });
  });

  it("names two", () => {
    assert.deepEqual(describeActors(["alex", "sam"], 2), {
      named: ["alex", "sam"],
      others: 0,
    });
  });

  it("names two and counts the rest", () => {
    // A notification is a sentence, and "Alex, Sam and four others" is where a
    // sentence stops being one.
    assert.deepEqual(describeActors(["alex", "sam", "jo"], 6), {
      named: ["alex", "sam"],
      others: 4,
    });
  });

  it("counts everybody when the reader may see none of them", () => {
    // Named where the reader is entitled to know who they are, counted where
    // they are not. An aggregated notification must not become a way to learn
    // who somebody is.
    assert.deepEqual(describeActors([], 3), { named: [], others: 3 });
  });

  it("never reports a negative remainder", () => {
    assert.deepEqual(describeActors(["alex", "sam"], 1), { named: ["alex", "sam"], others: 0 });
  });
});
