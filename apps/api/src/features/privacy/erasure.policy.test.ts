import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  classifyFailure,
  DEFAULT_BACKOFF_MS,
  DEFAULT_MAXIMUM_ATTEMPTS,
  erasableUploads,
  retryAfter,
  stateAfterFailure,
  subjectKindOf,
} from "./erasure.policy.js";

const at = new Date("2026-06-10T12:00:00Z");

describe("subjectKindOf", () => {
  it("recognises a Moment", () => {
    assert.equal(subjectKindOf("moment"), "moment");
  });

  it("recognises an account", () => {
    assert.equal(subjectKindOf("account"), "account");
  });

  it("leaves alone a subject this deployment cannot erase", () => {
    // The ledger will gain further subjects. A worker rolled out before the
    // code that handles one must leave those pending rather than fail them: a
    // pending request can still be done, a failed one needs somebody to notice.
    assert.equal(subjectKindOf("something_invented_later"), undefined);
    assert.equal(subjectKindOf(""), undefined);
  });
});

describe("classifyFailure", () => {
  it("treats a constraint violation as permanent", () => {
    // Something still references what erasure is trying to remove. That is a
    // defect rather than a hiccup, and retrying it for ten hours before giving
    // up only delays somebody seeing the real error.
    const refusal = new Error("update or delete violates foreign key constraint");

    refusal.name = "QueryFailedError";

    assert.equal(classifyFailure(refusal), "permanent");
  });

  it("treats an unreachable store as transient", () => {
    assert.equal(classifyFailure(new Error("connection reset")), "transient");
  });

  it("treats anything it does not recognise as transient", () => {
    // Erring towards finishing late rather than abandoning. The attempt ceiling
    // stops an unrecognised permanent failure a few attempts later; erring the
    // other way would leave media in storage somebody has been told is gone.
    assert.equal(classifyFailure("a string nobody expected"), "transient");
    assert.equal(classifyFailure(undefined), "transient");
    assert.equal(classifyFailure({ name: "QueryFailedError" }), "transient");
  });
});

describe("stateAfterFailure", () => {
  it("stops at once on a permanent failure", () => {
    assert.equal(stateAfterFailure("permanent", 1, 10), "failed");
  });

  it("stops on a permanent failure however few attempts have been made", () => {
    // A store that refused will refuse again. Counting to ten first would only
    // delay somebody finding out.
    assert.equal(stateAfterFailure("permanent", 0, 10), "failed");
    assert.equal(stateAfterFailure("permanent", 9, 10), "failed");
  });

  it("keeps a transient failure pending below the ceiling", () => {
    assert.equal(stateAfterFailure("transient", 1, 10), "pending");
    assert.equal(stateAfterFailure("transient", 9, 10), "pending");
  });

  it("abandons a transient failure at the ceiling", () => {
    assert.equal(stateAfterFailure("transient", 10, 10), "abandoned");
  });

  it("abandons a transient failure past the ceiling", () => {
    // Reachable if the ceiling is lowered while requests are in flight.
    assert.equal(stateAfterFailure("transient", 40, 10), "abandoned");
  });

  it("has a ceiling by default", () => {
    assert.equal(stateAfterFailure("transient", DEFAULT_MAXIMUM_ATTEMPTS), "abandoned");
    assert.equal(stateAfterFailure("transient", DEFAULT_MAXIMUM_ATTEMPTS - 1), "pending");
  });
});

describe("retryAfter", () => {
  it("waits the first delay after one failure", () => {
    assert.equal(retryAfter(at, 1, 1_000).toISOString(), "2026-06-10T12:00:01.000Z");
  });

  it("doubles with each further attempt", () => {
    assert.equal(retryAfter(at, 2, 1_000).toISOString(), "2026-06-10T12:00:02.000Z");
    assert.equal(retryAfter(at, 3, 1_000).toISOString(), "2026-06-10T12:00:04.000Z");
    assert.equal(retryAfter(at, 4, 1_000).toISOString(), "2026-06-10T12:00:08.000Z");
  });

  it("caps the delay", () => {
    // Unbounded doubling reaches days, and a request due in three days is a
    // deletion nobody will see finish.
    const far = retryAfter(at, 40, DEFAULT_BACKOFF_MS);

    assert.equal(far.toISOString(), "2026-06-10T18:00:00.000Z");
  });

  it("never schedules a retry in the past", () => {
    for (const attempts of [0, 1, 5, 40]) {
      assert.ok(retryAfter(at, attempts, 1_000).getTime() >= at.getTime(), String(attempts));
    }
  });
});

describe("erasableUploads", () => {
  it("erases an upload nothing living references", () => {
    assert.deepEqual(erasableUploads(["one", "two"], []), ["one", "two"]);
  });

  it("spares an upload a living Moment still references", () => {
    // The guard that keeps erasing one Moment from breaking another. Nothing
    // prevents attaching one upload twice, and this declines to destroy bytes
    // something still points at rather than deciding whether it should be
    // possible.
    assert.deepEqual(erasableUploads(["one", "two"], ["two"]), ["one"]);
  });

  it("erases an upload only other deleted Moments reference", () => {
    // Those are awaiting erasure themselves. Whichever request ran last would
    // otherwise leave the bytes behind for good, each deferring to the other.
    assert.deepEqual(erasableUploads(["one"], []), ["one"]);
  });

  it("erases nothing when everything is still in use", () => {
    assert.deepEqual(erasableUploads(["one", "two"], ["one", "two"]), []);
  });

  it("erases nothing when there was nothing attached", () => {
    assert.deepEqual(erasableUploads([], []), []);
    assert.deepEqual(erasableUploads([], ["one"]), []);
  });

  it("names an upload once however often it was attached", () => {
    assert.deepEqual(erasableUploads(["one", "one", "two"], []), ["one", "two"]);
  });
});
