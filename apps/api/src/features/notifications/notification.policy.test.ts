import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  aggregates,
  aggregationKey,
  categoryOf,
  describeActors,
  isRequired,
  permits,
  recipientOf,
  urgencyOf,
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
  "participation_proposed",
  "participation_accepted",
  "participation_rejected",
  "participation_withdrawn",
  "upload_ready",
  "upload_rejected",
  "content_moderated",
  "password_set",
  "password_changed",
  "phone_claimed",
  "phone_removed",
  "email_verified",
  "sessions_revoked",
  "saved_view_expanded",
  "location_expanded",
  "real_world_event_expanded",
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

  it("sorts history expanding into its own family, not into social", () => {
    // Nobody did anything to the reader. What changed is how much of history
    // Chronologity holds, which `saved-views.md` insists is a different claim
    // from the past having changed — and somebody who silences reactions has
    // not asked to stop hearing that a place they follow has gained a
    // photograph of 1969.
    for (const type of ["saved_view_expanded", "location_expanded", "real_world_event_expanded"]) {
      assert.equal(categoryOf(type), "history", type);
    }
  });

  it("lets somebody silence history without silencing security", () => {
    // The reason it is its own family rather than folded into an existing one.
    assert.equal(isRequired("history"), false);
    assert.equal(isRequired("security"), true);
    assert.equal(isRequired("moderation"), true);
  });

  it("sorts upload outcomes into media", () => {
    assert.equal(categoryOf("upload_ready"), "media");
    assert.equal(categoryOf("upload_rejected"), "media");
  });

  it("sorts a decision about your content into moderation", () => {
    assert.equal(categoryOf("content_moderated"), "moderation");
  });

  it("sorts a change to how the account is secured into security", () => {
    assert.equal(categoryOf("password_changed"), "security");
    assert.equal(categoryOf("phone_claimed"), "security");
    assert.equal(categoryOf("sessions_revoked"), "security");
  });

  it("places a type it does not know nowhere", () => {
    // A topic gains event types over time. A consumer that dies on the first
    // one it has not been taught about turns an additive change into an outage.
    assert.equal(categoryOf("something_nobody_has_written_yet"), undefined);
  });
});

const CATEGORIES: NotificationCategory[] = ["social", "media", "moderation", "security"];

describe("isRequired", () => {
  it("requires moderation", () => {
    // Somebody must be told what was done to their content: an appeal against a
    // decision they were never told about is not a right they have.
    assert.equal(isRequired("moderation"), true);
  });

  it("requires security", () => {
    // Every security message describes a step somebody taking over an account
    // has to perform. A preference that could silence them would be the first
    // thing an attacker turned off.
    assert.equal(isRequired("security"), true);
  });

  it("requires nothing else", () => {
    assert.equal(isRequired("social"), false);
    assert.equal(isRequired("media"), false);
  });

  it("requires neither category that carries engagement", () => {
    // Narrowly defined, as the document asks. The warning it gives is against
    // labelling engagement as required in order to bypass preferences, and
    // social and media are where engagement lives.
    assert.equal(CATEGORIES.filter(isRequired).length, 2);
    assert.equal(isRequired("social"), false);
    assert.equal(isRequired("media"), false);
  });
});

describe("urgencyOf", () => {
  it("lets security wait for nothing", () => {
    assert.equal(urgencyOf("security"), "immediate");
  });

  it("keeps moderation out of a digest but lets it wait out quiet hours", () => {
    // The two required categories differ only here. Both always arrive; one
    // arrives now and one arrives at eight.
    assert.equal(urgencyOf("moderation"), "prompt");
  });

  it("lets everything else be scheduled freely", () => {
    assert.equal(urgencyOf("social"), "ordinary");
    assert.equal(urgencyOf("media"), "ordinary");
  });

  it("never digests anything that cannot be switched off", () => {
    // The property that matters, stated over the pair rather than case by case:
    // being told what was done to your content must not wait for tomorrow's
    // summary.
    for (const category of CATEGORIES.filter(isRequired)) {
      assert.notEqual(urgencyOf(category), "ordinary", category);
    }
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

describe("aggregates", () => {
  it("collapses ordinary activity", () => {
    assert.equal(aggregates("social"), true);
    assert.equal(aggregates("media"), true);
  });

  it("keeps every required notification separate", () => {
    // Not about presentation. A delivery is opened once per notification per
    // channel, so a second one collapsing into a standing entry would be
    // announced to nobody — the first email having already gone.
    assert.equal(aggregates("moderation"), false);
    assert.equal(aggregates("security"), false);
  });

  it("collapses exactly what may be switched off", () => {
    for (const category of CATEGORIES) {
      assert.equal(aggregates(category), !isRequired(category), category);
    }
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
