import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  checkAddition,
  checkMedia,
  checkOccurrence,
  checkRemoval,
  checkReorder,
  describeAdditionRejection,
  describeMediaRejection,
  describeOccurrenceRejection,
  describeRemovalRejection,
  describeReorderRejection,
  positionMedia,
} from "./moment.policy.js";

const at = (iso: string): string => new Date(iso).toISOString();

describe("checking an occurrence", () => {
  it("accepts an interval that ends after it starts", () => {
    assert.equal(
      checkOccurrence({
        start: at("1998-06-01T00:00:00Z"),
        end: at("1998-08-31T23:59:59Z"),
        precision: "month",
      }),
      undefined,
    );
  });

  it("accepts an instant whose ends are the same moment", () => {
    const moment = at("2014-06-12T19:30:00Z");

    assert.equal(checkOccurrence({ start: moment, end: moment, precision: "instant" }), undefined);
  });

  it("accepts an occurrence in the future", () => {
    const later = at("2099-01-01T00:00:00Z");

    // Nothing refuses this. `moments.md:247` says a future plan is not
    // *automatically* a Moment, which is softer than a prohibition, and the
    // question is deliberately left open rather than answered here.
    assert.equal(checkOccurrence({ start: later, end: later, precision: "instant" }), undefined);
  });

  it("refuses an interval that ends before it starts", () => {
    assert.equal(
      checkOccurrence({
        start: at("2014-06-12T20:00:00Z"),
        end: at("2014-06-12T19:00:00Z"),
        precision: "day",
      }),
      "interval_reversed",
    );
  });

  it("refuses an instant spanning two different moments", () => {
    assert.equal(
      checkOccurrence({
        start: at("2014-06-12T19:00:00Z"),
        end: at("2014-06-12T20:00:00Z"),
        precision: "instant",
      }),
      "instant_not_a_point",
    );
  });

  it("reports a reversed interval before it considers precision", () => {
    // Both rules are broken. The reversal is the one worth saying: it is the
    // reason the other cannot be judged.
    assert.equal(
      checkOccurrence({
        start: at("2014-06-12T20:00:00Z"),
        end: at("2014-06-12T19:00:00Z"),
        precision: "instant",
      }),
      "interval_reversed",
    );
  });
});

describe("checking the media", () => {
  it("accepts one piece of media", () => {
    assert.equal(checkMedia(["a"]), undefined);
  });

  it("accepts several distinct pieces", () => {
    assert.equal(checkMedia(["a", "b", "c"]), undefined);
  });

  it("refuses a moment with no media", () => {
    assert.equal(checkMedia([]), "no_media");
  });

  it("refuses the same file twice", () => {
    // One file cannot occupy two positions in one order.
    assert.equal(checkMedia(["a", "b", "a"]), "duplicate_media");
  });
});

describe("describing why something was refused", () => {
  it("explains a reversed interval", () => {
    assert.equal(
      describeOccurrenceRejection("interval_reversed"),
      "An occurrence cannot end before it starts",
    );
  });

  it("explains an instant that is not a point", () => {
    assert.equal(
      describeOccurrenceRejection("instant_not_a_point"),
      "An occurrence known to the instant must start and end at the same moment",
    );
  });

  it("explains missing media", () => {
    assert.equal(describeMediaRejection("no_media"), "A moment needs at least one image or video");
  });

  it("explains repeated media", () => {
    assert.equal(
      describeMediaRejection("duplicate_media"),
      "A moment cannot show the same file twice",
    );
  });
});

describe("placing media in order", () => {
  it("numbers from zero, in the order given", () => {
    assert.deepEqual(positionMedia(["b", "a", "c"]), [
      { uploadId: "b", position: 0 },
      { uploadId: "a", position: 1 },
      { uploadId: "c", position: 2 },
    ]);
  });

  it("places a single piece at the front", () => {
    assert.deepEqual(positionMedia(["only"]), [{ uploadId: "only", position: 0 }]);
  });

  it("places nothing when given nothing", () => {
    // Unreachable through the service, which checks for media first. Covered
    // because the function is total and should stay that way.
    assert.deepEqual(positionMedia([]), []);
  });
});

describe("checking a reorder", () => {
  it("accepts the same media in a different order", () => {
    assert.equal(checkReorder(["c", "a", "b"], ["a", "b", "c"]), undefined);
  });

  it("accepts an order that changes nothing", () => {
    assert.equal(checkReorder(["a", "b"], ["a", "b"]), undefined);
  });

  it("accepts a single medium", () => {
    assert.equal(checkReorder(["a"], ["a"]), undefined);
  });

  it("refuses a list that drops something", () => {
    assert.equal(checkReorder(["a"], ["a", "b"]), "not_a_permutation");
  });

  it("refuses a list that adds something", () => {
    // An addition wearing the wrong name: it would skip the check that the
    // file is ready and belongs to the author.
    assert.equal(checkReorder(["a", "b", "c"], ["a", "b"]), "not_a_permutation");
  });

  it("refuses a list of the right length naming something absent", () => {
    assert.equal(checkReorder(["a", "z"], ["a", "b"]), "not_a_permutation");
  });

  it("refuses a list that repeats one medium in place of another", () => {
    // Same length, same set membership for the first element — only counting
    // each occurrence catches this.
    assert.equal(checkReorder(["a", "a"], ["a", "b"]), "not_a_permutation");
  });
});

describe("checking a removal", () => {
  it("accepts removing one of several", () => {
    assert.equal(checkRemoval("a", ["a", "b"]), undefined);
  });

  it("refuses removing something the moment does not have", () => {
    assert.equal(checkRemoval("z", ["a", "b"]), "not_present");
  });

  it("refuses removing the last medium", () => {
    // Media is mandatory, so this would leave a Moment that could not have been
    // created. Deleting a medium is not deleting the Moment.
    assert.equal(checkRemoval("a", ["a"]), "last_medium");
  });

  it("reports an absent medium before it considers whether it is the last", () => {
    assert.equal(checkRemoval("z", ["a"]), "not_present");
  });
});

describe("checking an addition", () => {
  it("accepts media the moment does not have", () => {
    assert.equal(checkAddition(["c"], ["a", "b"]), undefined);
  });

  it("accepts several at once", () => {
    assert.equal(checkAddition(["c", "d"], ["a"]), undefined);
  });

  it("accepts adding nothing", () => {
    // Unreachable through the service, which requires at least one. Covered
    // because the function is total and should stay that way.
    assert.equal(checkAddition([], ["a"]), undefined);
  });

  it("refuses media the moment already shows", () => {
    assert.equal(checkAddition(["a"], ["a", "b"]), "already_present");
  });

  it("refuses when only one of several is already present", () => {
    assert.equal(checkAddition(["c", "b"], ["a", "b"]), "already_present");
  });
});

describe("describing why an edit was refused", () => {
  it("explains a reorder that is not a permutation", () => {
    assert.equal(
      describeReorderRejection(),
      "A reorder must list exactly the media the moment already has",
    );
  });

  it("explains removing something absent", () => {
    assert.equal(describeRemovalRejection("not_present"), "That file is not part of this moment");
  });

  it("explains removing the last medium, and says what to do instead", () => {
    assert.equal(
      describeRemovalRejection("last_medium"),
      "A moment needs at least one image or video; delete the moment instead",
    );
  });

  it("explains adding something already there", () => {
    assert.equal(describeAdditionRejection(), "A moment cannot show the same file twice");
  });
});
