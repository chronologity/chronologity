import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { MAXIMUM_PARTICIPANTS } from "@chronologity/contracts";
import {
  checkProposal,
  checkRemoval,
  checkResolution,
  describeProposalRejection,
  describeResolutionRejection,
} from "./participation.policy.js";

/**
 * The rules deciding who may say somebody was somewhere.
 *
 * Every one of these is a claim about where a person was and who they were
 * with, which `privacy.md:300` singles out as disclosing more than a name. So
 * the negative paths matter more than the positive ones, and what a refusal
 * *says* matters as much as that it refuses.
 */

const CREATOR = "creator";
const NAMED = "named";
const STRANGER = "stranger";

const proposal = (over: Partial<Parameters<typeof checkProposal>[0]> = {}) => ({
  proposerUserId: CREATOR,
  namedUserId: NAMED,
  authorUserId: CREATOR,
  ...over,
});

describe("checkProposal", () => {
  it("permits a creator naming somebody else", () => {
    assert.equal(checkProposal(proposal(), 0), undefined);
  });

  it("refuses somebody who did not record the Moment", () => {
    assert.equal(checkProposal(proposal({ proposerUserId: STRANGER }), 0), "not_your_moment");
  });

  it("refuses a creator naming themselves", () => {
    // Authorship already says they were there. A second claim about the same
    // fact is one they could withdraw, leaving a Moment whose author says they
    // were not present.
    assert.equal(checkProposal(proposal({ namedUserId: CREATOR }), 0), "self_participation");
  });

  it("refuses somebody who has refused this proposer", () => {
    const barriers = { refusedMe: true, theyBlockedMe: false, iBlockedThem: false };

    assert.equal(checkProposal(proposal(), 0, barriers), "refused_by_them");
  });

  it("refuses across a Block in either direction", () => {
    assert.equal(
      checkProposal(proposal(), 0, { refusedMe: false, theyBlockedMe: true, iBlockedThem: false }),
      "blocked_by_them",
    );
    assert.equal(
      checkProposal(proposal(), 0, { refusedMe: false, theyBlockedMe: false, iBlockedThem: true }),
      "blocked_them",
    );
  });

  it("refuses the hundred and first person", () => {
    assert.equal(checkProposal(proposal(), MAXIMUM_PARTICIPANTS - 1), undefined);
    assert.equal(
      checkProposal(proposal(), MAXIMUM_PARTICIPANTS),
      "too_many_participants",
    );
  });

  it("answers a refusal the same way whether the Moment is full or empty", () => {
    // Otherwise a proposer learns how many people a Moment names by watching
    // which refusal they get, from a Moment they may not be able to read.
    const barriers = { refusedMe: true, theyBlockedMe: false, iBlockedThem: false };

    assert.equal(checkProposal(proposal(), 0, barriers), "refused_by_them");
    assert.equal(checkProposal(proposal(), MAXIMUM_PARTICIPANTS, barriers), "refused_by_them");
  });

  it("decides authorship before anything that would admit the Moment exists", () => {
    // A stranger proposing into a full Moment they cannot see must be told the
    // Moment does not exist, not that it is full.
    assert.equal(
      checkProposal(proposal({ proposerUserId: STRANGER }), MAXIMUM_PARTICIPANTS),
      "not_your_moment",
    );
  });
});

describe("checkResolution", () => {
  it("permits the person named to answer", () => {
    assert.equal(checkResolution({ userId: NAMED, status: "proposed" }, NAMED), undefined);
  });

  it("refuses the creator answering on their behalf", () => {
    // Invariant 2, and the whole model: only the person named may establish
    // their own participation.
    assert.equal(
      checkResolution({ userId: NAMED, status: "proposed" }, CREATOR),
      "not_yours_to_answer",
    );
  });

  it("refuses a stranger", () => {
    assert.equal(
      checkResolution({ userId: NAMED, status: "proposed" }, STRANGER),
      "not_yours_to_answer",
    );
  });

  it("refuses answering something already answered", () => {
    for (const status of ["accepted", "rejected", "withdrawn"]) {
      assert.equal(checkResolution({ userId: NAMED, status }, NAMED), "already_answered");
    }
  });
});

describe("checkRemoval", () => {
  const at = (userId: string, status: string) => ({ userId, authorUserId: CREATOR, status });

  it("lets the participant withdraw what they accepted", () => {
    assert.deepEqual(checkRemoval(at(NAMED, "accepted"), NAMED), { act: "withdraw" });
  });

  it("lets the creator cancel a proposal nobody answered", () => {
    assert.deepEqual(checkRemoval(at(NAMED, "proposed"), CREATOR), { act: "cancel" });
  });

  it("refuses the creator removing a participation somebody accepted", () => {
    // That record belongs to the person who confirmed it. The creator's
    // recourse is to delete the Moment.
    assert.deepEqual(checkRemoval(at(NAMED, "accepted"), CREATOR), {
      reason: "not_yours_to_remove",
    });
  });

  it("refuses the participant withdrawing something they never accepted", () => {
    for (const status of ["proposed", "rejected", "withdrawn"]) {
      assert.deepEqual(checkRemoval(at(NAMED, status), NAMED), { reason: "already_answered" });
    }
  });

  it("refuses a stranger whatever the state", () => {
    for (const status of ["proposed", "accepted", "rejected", "withdrawn"]) {
      assert.deepEqual(checkRemoval(at(NAMED, status), STRANGER), {
        reason: "not_yours_to_remove",
      });
    }
  });
});

describe("what a refusal says", () => {
  it("reports a Block and a refusal as the account not existing", () => {
    // `social-graph.md:289` forbids announcing a Block. A refusal earns the
    // same silence for a stronger reason: it exists so somebody can stop being
    // asked, and saying so hands the asker what they need to ask another way.
    assert.equal(describeProposalRejection("blocked_by_them"), "No such user");
    assert.equal(describeProposalRejection("refused_by_them"), "No such user");
  });

  it("reports somebody else's Moment as no Moment at all", () => {
    assert.equal(describeProposalRejection("not_your_moment"), "No such Moment");
  });

  it("says plainly what the asker already knows", () => {
    assert.match(describeProposalRejection("blocked_them"), /you have blocked/i);
    assert.match(describeProposalRejection("self_participation"), /already says you were there/i);
    assert.match(describeProposalRejection("too_many_participants"), /at most 100/);
  });

  it("distinguishes too late from not yours", () => {
    assert.match(describeResolutionRejection("already_answered"), /already been answered/i);
    assert.equal(describeResolutionRejection("not_yours_to_answer"), "No such participation");
  });
});
