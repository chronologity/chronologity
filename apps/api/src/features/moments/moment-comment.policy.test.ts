import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { COMMENT_MAX_LENGTH, type CommentPolicy } from "@chronologity/contracts";
import {
  checkComment,
  checkCommentBody,
  describeCommentBodyRefusal,
  describeCommentRefusal,
} from "./moment-comment.policy.js";

const AUTHOR = "author";
const STRANGER = "stranger";

const facts = (over: Partial<Parameters<typeof checkComment>[1]> = {}) => ({
  authorUserId: AUTHOR,
  viewerUserId: STRANGER,
  followsAuthor: false,
  blockedEitherWay: false,
  ...over,
});

describe("checkComment", () => {
  it("lets anybody comment when the author said anyone", () => {
    assert.equal(checkComment("anyone", facts()), undefined);
  });

  it("refuses a stranger when the author said followers", () => {
    assert.equal(checkComment("followers", facts()), "not_a_follower");
  });

  it("admits a follower when the author said followers", () => {
    assert.equal(checkComment("followers", facts({ followsAuthor: true })), undefined);
  });

  it("refuses everybody when the discussion is closed", () => {
    assert.equal(checkComment("disabled", facts()), "comments_disabled");
  });

  it("lets the author comment under every policy", () => {
    for (const policy of ["anyone", "followers", "disabled"] as const) {
      const refusal = checkComment(policy, facts({ viewerUserId: AUTHOR }));

      // Closing a discussion shuts other people out; it is not a way of
      // silencing yourself, and nobody follows themselves.
      assert.equal(refusal, undefined, policy);
    }
  });

  it("refuses a blocked person whatever the policy says", () => {
    for (const policy of ["anyone", "followers", "disabled"] as const) {
      const refusal = checkComment(policy, facts({ blockedEitherWay: true, followsAuthor: true }));

      assert.equal(refusal, "blocked", policy);
    }
  });

  it("refuses a blocked author on their own Moment", () => {
    const refusal = checkComment("anyone", facts({
      viewerUserId: AUTHOR,
      blockedEitherWay: true,
    }));

    // Blocking is answered before authorship, so the check cannot be reordered
    // into one where a blocked person learns the policy.
    assert.equal(refusal, "blocked");
  });

  it("refuses a policy it does not recognise", () => {
    const refusal = checkComment("committee" as CommentPolicy, facts());

    // A policy nobody recognises must close the discussion rather than open it.
    assert.equal(refusal, "unknown_policy");
  });
});

describe("checkCommentBody", () => {
  it("accepts something somebody wrote", () => {
    assert.equal(checkCommentBody("I remember that afternoon"), undefined);
  });

  it("refuses nothing at all", () => {
    assert.equal(checkCommentBody(""), "empty");
  });

  it("refuses whitespace pretending to be something", () => {
    assert.equal(checkCommentBody("   \n\t  "), "empty");
  });

  it("accepts a comment of exactly the limit", () => {
    assert.equal(checkCommentBody("a".repeat(COMMENT_MAX_LENGTH)), undefined);
  });

  it("refuses one character more", () => {
    assert.equal(checkCommentBody("a".repeat(COMMENT_MAX_LENGTH + 1)), "too_long");
  });

  it("measures after trimming, not before", () => {
    const padded = `  ${"a".repeat(COMMENT_MAX_LENGTH)}  `;

    assert.equal(checkCommentBody(padded), undefined);
  });
});

describe("describeCommentRefusal", () => {
  it("never says that somebody has been blocked", () => {
    const blocked = describeCommentRefusal("blocked");

    assert.equal(blocked, describeCommentRefusal("comments_disabled"));
    assert.doesNotMatch(blocked, /block/i);
  });

  it("says something usable for every refusal", () => {
    for (const reason of ["blocked", "comments_disabled", "not_a_follower", "unknown_policy"] as const) {
      assert.ok(describeCommentRefusal(reason).length > 10, reason);
    }
  });
});

describe("describeCommentBodyRefusal", () => {
  it("says something usable for every refusal", () => {
    for (const reason of ["empty", "too_long"] as const) {
      assert.ok(describeCommentBodyRefusal(reason).length > 10, reason);
    }
  });

  it("names the limit, so it can be worked to", () => {
    assert.match(describeCommentBodyRefusal("too_long"), new RegExp(String(COMMENT_MAX_LENGTH)));
  });
});
