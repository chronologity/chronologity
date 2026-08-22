import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  checkFollow,
  checkRequestResolution,
  describeFollowRejection,
  describeRequestRejection,
} from "./follow.policy.js";

const pending = { requesterUserId: "asker", requestedUserId: "asked", status: "pending" };

describe("checking a follow", () => {
  it("accepts one person following another", () => {
    assert.equal(checkFollow("a", "b"), undefined);
  });

  it("refuses somebody following themselves", () => {
    // Their own history is already theirs, and this would double every count
    // ever built on the relationship.
    assert.equal(checkFollow("a", "a"), "self_follow");
  });
});

describe("checking who may resolve a request", () => {
  it("lets the person asked accept or decline", () => {
    assert.equal(checkRequestResolution(pending, "asked", "requested"), undefined);
  });

  it("lets the asker cancel", () => {
    assert.equal(checkRequestResolution(pending, "asker", "requester"), undefined);
  });

  it("refuses the asker trying to accept on their own behalf", () => {
    assert.equal(
      checkRequestResolution(pending, "asker", "requested"),
      "not_yours_to_resolve",
    );
  });

  it("refuses the person asked trying to cancel somebody else's request", () => {
    assert.equal(
      checkRequestResolution(pending, "asked", "requester"),
      "not_yours_to_resolve",
    );
  });

  it("refuses a stranger entirely", () => {
    assert.equal(
      checkRequestResolution(pending, "nobody", "requested"),
      "not_yours_to_resolve",
    );
  });

  it("refuses one that has already been accepted", () => {
    assert.equal(
      checkRequestResolution({ ...pending, status: "accepted" }, "asked", "requested"),
      "already_resolved",
    );
  });

  it("refuses one that has already been declined", () => {
    assert.equal(
      checkRequestResolution({ ...pending, status: "declined" }, "asked", "requested"),
      "already_resolved",
    );
  });

  it("refuses one that has already been cancelled", () => {
    assert.equal(
      checkRequestResolution({ ...pending, status: "cancelled" }, "asker", "requester"),
      "already_resolved",
    );
  });

  it("reports the wrong person before it considers whether it is still open", () => {
    // A stranger must not learn that a request exists at all, let alone how far
    // it has got.
    assert.equal(
      checkRequestResolution({ ...pending, status: "accepted" }, "nobody", "requested"),
      "not_yours_to_resolve",
    );
  });
});

describe("describing why something was refused", () => {
  it("explains a self-follow", () => {
    assert.equal(describeFollowRejection(), "You cannot follow yourself");
  });

  it("explains a request that has already been answered", () => {
    assert.equal(
      describeRequestRejection("already_resolved"),
      "That request has already been answered",
    );
  });

  it("reports somebody else's request as one that does not exist", () => {
    // Saying "not yours" would confirm the identifier is real.
    assert.equal(describeRequestRejection("not_yours_to_resolve"), "No such request");
  });
});
