import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ModerationState, ReportStatus } from "@chronologity/contracts";
import {
  appealReverses,
  carriesWarning,
  hidesFromOthers,
  isAdult,
  isBurst,
  mayTransitionReport,
  narrowsToAudience,
  requiresAdult,
  reviewPriority,
  suppressesAmplification,
} from "./moderation.policy.js";

const NOW = new Date("2026-08-25T12:00:00.000Z");

describe("hidesFromOthers", () => {
  it("hides a removed subject", () => {
    assert.equal(hidesFromOthers("removed"), true);
  });

  it("hides a subject withheld during review", () => {
    assert.equal(hidesFromOthers("temporarily_unavailable"), true);
  });

  it("hides nothing that is allowed", () => {
    assert.equal(hidesFromOthers("allowed"), false);
  });

  it("hides nothing that only carries a warning", () => {
    assert.equal(hidesFromOthers("warned"), false);
  });

  it("hides nothing that is only kept out of amplification", () => {
    assert.equal(hidesFromOthers("restricted_from_amplification"), false);
  });

  it("hides nothing that is narrowed to an audience", () => {
    assert.equal(hidesFromOthers("restricted_to_authorized_audience"), false);
  });

  it("hides nothing that is age restricted", () => {
    assert.equal(hidesFromOthers("age_restricted"), false);
  });

  it("hides a state it does not recognise", () => {
    assert.equal(hidesFromOthers("impounded" as ModerationState), true);
  });
});

describe("narrowsToAudience", () => {
  it("narrows the state that says so", () => {
    assert.equal(narrowsToAudience("restricted_to_authorized_audience"), true);
  });

  it("narrows nothing else", () => {
    assert.equal(narrowsToAudience("removed"), false);
  });
});

describe("requiresAdult", () => {
  it("gates the age-restricted state", () => {
    assert.equal(requiresAdult("age_restricted"), true);
  });

  it("gates nothing else", () => {
    assert.equal(requiresAdult("warned"), false);
  });
});

describe("suppressesAmplification", () => {
  it("amplifies what is allowed", () => {
    assert.equal(suppressesAmplification("allowed"), false);
  });

  it("amplifies what only carries a warning", () => {
    assert.equal(suppressesAmplification("warned"), false);
  });

  it("suppresses what is kept out of amplification", () => {
    assert.equal(suppressesAmplification("restricted_from_amplification"), true);
  });

  it("suppresses what is narrowed to an audience", () => {
    assert.equal(suppressesAmplification("restricted_to_authorized_audience"), true);
  });

  it("suppresses what is age restricted", () => {
    assert.equal(suppressesAmplification("age_restricted"), true);
  });

  it("suppresses what is withheld during review", () => {
    assert.equal(suppressesAmplification("temporarily_unavailable"), true);
  });

  it("suppresses what is removed", () => {
    assert.equal(suppressesAmplification("removed"), true);
  });

  it("suppresses a state it does not recognise", () => {
    assert.equal(suppressesAmplification("impounded" as ModerationState), true);
  });

  it("suppresses everything it hides", () => {
    const states: ModerationState[] = [
      "allowed",
      "warned",
      "restricted_from_amplification",
      "restricted_to_authorized_audience",
      "age_restricted",
      "temporarily_unavailable",
      "removed",
    ];

    // Something nobody may read must not be promoted to them either. Stated as
    // a relationship between the two rules rather than as seven more cases, so
    // an eighth state cannot satisfy one and not the other.
    for (const state of states) {
      if (hidesFromOthers(state)) {
        assert.equal(suppressesAmplification(state), true, state);
      }
    }
  });
});

describe("carriesWarning", () => {
  it("warns on the state whose purpose is to be seen", () => {
    assert.equal(carriesWarning("warned"), true);
  });

  it("warns on nothing else", () => {
    assert.equal(carriesWarning("age_restricted"), false);
  });
});

describe("isAdult", () => {
  it("refuses somebody with no recorded birthdate", () => {
    assert.equal(isAdult(undefined, NOW), false);
  });

  it("admits somebody on their eighteenth birthday", () => {
    assert.equal(isAdult(new Date("2008-08-25T00:00:00.000Z"), NOW), true);
  });

  it("refuses somebody the day before their eighteenth birthday", () => {
    assert.equal(isAdult(new Date("2008-08-26T00:00:00.000Z"), NOW), false);
  });

  it("admits somebody well over eighteen", () => {
    assert.equal(isAdult(new Date("1980-01-01T00:00:00.000Z"), NOW), true);
  });

  it("refuses a child", () => {
    assert.equal(isAdult(new Date("2020-01-01T00:00:00.000Z"), NOW), false);
  });

  it("puts a leap-day birthday on the first of March in a common year", () => {
    // Born 29 February 2008. The eighteenth birthday falls in 2026, which has
    // no 29 February, so date arithmetic lands it on 1 March. Subtracting
    // elapsed milliseconds and dividing by an average year would put it on the
    // wrong side of the boundary.
    assert.equal(isAdult(new Date("2008-02-29T00:00:00.000Z"), new Date("2026-02-28T12:00:00.000Z")), false);
    assert.equal(isAdult(new Date("2008-02-29T00:00:00.000Z"), new Date("2026-03-01T12:00:00.000Z")), true);
  });
});

describe("reviewPriority", () => {
  it("puts a single severe report high", () => {
    assert.equal(reviewPriority(1, "threat"), "high");
  });

  it("puts a repeated severe report at the top", () => {
    assert.equal(reviewPriority(2, "illegal_content"), "urgent");
  });

  it("puts a single report of harm at the ordinary level", () => {
    assert.equal(reviewPriority(1, "harassment"), "normal");
  });

  it("raises a widely reported harm", () => {
    assert.equal(reviewPriority(5, "hate"), "high");
  });

  it("puts a single spam report at the bottom", () => {
    assert.equal(reviewPriority(1, "spam"), "low");
  });

  it("raises widely reported spam only to ordinary", () => {
    assert.equal(reviewPriority(9, "spam"), "normal");
  });

  it("never lowers priority as reports accumulate", () => {
    // Volume orders a queue and decides nothing, but it must at least be
    // monotonic: a subject reported by more people cannot become less urgent.
    const ranks = { low: 0, normal: 1, high: 2, urgent: 3 };

    for (const reason of ["threat", "harassment", "spam"] as const) {
      let previous = -1;

      for (let count = 1; count <= 12; count += 1) {
        const rank = ranks[reviewPriority(count, reason)];

        assert.ok(rank >= previous, `${reason} at ${count}`);
        previous = rank;
      }
    }
  });

  it("ranks one severe report above many trivial ones", () => {
    const ranks = { low: 0, normal: 1, high: 2, urgent: 3 };

    assert.ok(ranks[reviewPriority(1, "threat")] > ranks[reviewPriority(50, "spam")]);
  });
});

describe("isBurst", () => {
  const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60 * 1000);

  it("flags five reports inside the hour", () => {
    assert.equal(isBurst([at(1), at(2), at(3), at(4), at(5)], NOW), true);
  });

  it("does not flag four", () => {
    assert.equal(isBurst([at(1), at(2), at(3), at(4)], NOW), false);
  });

  it("does not flag the same five spread over days", () => {
    assert.equal(isBurst([at(61), at(200), at(4000), at(9000), at(20000)], NOW), false);
  });

  it("does not flag an empty history", () => {
    assert.equal(isBurst([], NOW), false);
  });

  it("counts a report exactly on the window edge", () => {
    assert.equal(isBurst([at(60), at(1), at(2), at(3), at(4)], NOW), true);
  });
});

describe("mayTransitionReport", () => {
  it("lets a new report be taken up", () => {
    assert.equal(mayTransitionReport("submitted", "under_review"), true);
  });

  it("lets a new report be resolved directly", () => {
    assert.equal(mayTransitionReport("submitted", "resolved"), true);
  });

  it("lets a new report be closed directly", () => {
    assert.equal(mayTransitionReport("submitted", "closed"), true);
  });

  it("lets a report under review be resolved", () => {
    assert.equal(mayTransitionReport("under_review", "resolved"), true);
  });

  it("lets a report under review be closed", () => {
    assert.equal(mayTransitionReport("under_review", "closed"), true);
  });

  it("refuses moving a report under review back to submitted", () => {
    assert.equal(mayTransitionReport("under_review", "submitted"), false);
  });

  it("refuses reopening a resolved report", () => {
    assert.equal(mayTransitionReport("resolved", "under_review"), false);
  });

  it("refuses reopening a closed report", () => {
    assert.equal(mayTransitionReport("closed", "submitted"), false);
  });

  it("refuses moving a report to the status it already holds", () => {
    // It would append an action recording a decision nobody made.
    assert.equal(mayTransitionReport("under_review", "under_review"), false);
    assert.equal(mayTransitionReport("submitted", "submitted"), false);
  });

  it("refuses a status it does not recognise", () => {
    assert.equal(mayTransitionReport("archived" as ReportStatus, "closed"), false);
  });
});

describe("appealReverses", () => {
  it("undoes a reversed appeal", () => {
    assert.equal(appealReverses("reversed"), true);
  });

  it("changes nothing on an upheld one", () => {
    assert.equal(appealReverses("upheld"), false);
  });
});
