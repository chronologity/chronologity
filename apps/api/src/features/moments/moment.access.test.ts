import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { commentReadableBy } from "./moment-comment.repository.js";
import { moderationPermits, privacyPermits, visibleToViewer } from "./moment.repository.js";

/**
 * The exact text of the rule that decides what a Viewer may read.
 *
 * Written to be boring, and written *before* the rule moves into a package both
 * applications import. It asserts nothing about meaning — the integration suites
 * do that — and everything about characters, so that a move which was supposed
 * to change nothing is proved to have changed nothing.
 *
 * A test of behaviour would not have caught what this is for. Dropping a clause
 * fails an integration test loudly; changing where a parenthesis sits, or which
 * side of an `OR` the author is admitted on, can leave every existing test
 * passing and still mean something different for a case nobody wrote down. This
 * is the rule that leaks when that happens.
 *
 * It will look like it is asserting the obvious right up until the day it is
 * the only thing that notices.
 */

describe("the Moment rule, as it stands today", () => {
  it("reads a Viewer and their age, and admits the author before anything else", () => {
    assert.equal(
      visibleToViewer("moment"),
      `(${privacyPermits("moment")} AND ${moderationPermits("moment")})`,
    );
  });

  it("states the privacy half exactly", () => {
    assert.equal(
      privacyPermits("moment"),
      `(
    moment.author_user_id = :viewerUserId
    OR (
      NOT EXISTS (
        SELECT 1 FROM user_blocks b
         WHERE (b.blocker_user_id = moment.author_user_id AND b.blocked_user_id = :viewerUserId)
            OR (b.blocker_user_id = :viewerUserId AND b.blocked_user_id = moment.author_user_id)
      )
      AND (
        moment.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM moment_audience a
           WHERE a.moment_id = moment.moment_id AND a.user_id = :viewerUserId
        )
      )
    )
  )`,
    );
  });

  it("states the moderation half exactly", () => {
    assert.equal(
      moderationPermits("moment"),
      `(
    moment.author_user_id = :viewerUserId
    OR (
      NOT EXISTS (
        SELECT 1 FROM users author
         WHERE author.user_id = moment.author_user_id
           AND author.status = 'suspended'
      )
      AND NOT EXISTS (
        SELECT 1 FROM moderation_states ms
         WHERE ms.subject_type = 'moment'
           AND ms.subject_id = moment.moment_id
           AND (
             ms.state IN ('removed', 'temporarily_unavailable')
             OR (ms.state = 'age_restricted' AND NOT :viewerIsAdult)
             OR (
               ms.state = 'restricted_to_authorized_audience'
               AND NOT EXISTS (
                 SELECT 1 FROM moment_audience a
                  WHERE a.moment_id = moment.moment_id AND a.user_id = :viewerUserId
               )
             )
           )
      )
    )
  )`,
    );
  });

  it("keeps age out of the privacy half", () => {
    // The property the relationship read depends on. Privacy decides whether a
    // far end is mentioned at all and moderation decides whether it is a
    // tombstone, so an age check leaking into the first would omit a Moment
    // that should have been marked unavailable — and silently.
    assert.ok(!privacyPermits("moment").includes("viewerIsAdult"));
  });

  it("takes the alias it is given, everywhere", () => {
    // Reading the far end of a relationship joins the Moment table twice, so a
    // hardcoded alias would compare a Moment against itself.
    assert.ok(!visibleToViewer("other").includes("moment."));
  });
});

describe("the comment rule, as it stands today", () => {
  it("states it exactly", () => {
    assert.equal(
      commentReadableBy("comment"),
      `(
    comment.author_user_id = :viewerUserId
    OR (
      NOT EXISTS (
        SELECT 1 FROM user_blocks b
         WHERE (b.blocker_user_id = comment.author_user_id AND b.blocked_user_id = :viewerUserId)
            OR (b.blocker_user_id = :viewerUserId AND b.blocked_user_id = comment.author_user_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM users commenter
         WHERE commenter.user_id = comment.author_user_id
           AND commenter.status = 'suspended'
      )
      AND NOT EXISTS (
        SELECT 1 FROM moderation_states ms
         WHERE ms.subject_type = 'comment'
           AND ms.subject_id = comment.comment_id
           AND ms.state IN ('removed', 'temporarily_unavailable')
      )
    )
  )`,
    );
  });

  it("asks nothing about age", () => {
    // Comments carry no age gate. The Moment above them does, and reaching one
    // means having passed it.
    assert.ok(!commentReadableBy("comment").includes("viewerIsAdult"));
  });
});
