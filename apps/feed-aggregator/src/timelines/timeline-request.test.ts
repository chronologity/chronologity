import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { ValidationError } from "../errors/aggregator-error.js";
import { specificationFor, type TimelineViewArguments } from "./timeline-request.js";

/**
 * What a client asked for, as the engine takes it.
 *
 * The rules the contract already enforces are exercised here too rather than
 * assumed. They are the reason this translates instead of validating, and a
 * test that trusted them would not notice the day the translation stopped
 * reaching them.
 */

const PERSON = randomUUID();
const PLACE = randomUUID();
const SOMEBODY = randomUUID();
const MOMENT = randomUUID();

const person = (): TimelineViewArguments => ({ scope: { type: "PERSON", id: PERSON } });
const place = (): TimelineViewArguments => ({ scope: { type: "LOCATION", id: PLACE } });
const at = (iso: string) => ({ occurredAt: new Date(iso), momentId: MOMENT });

describe("the scope", () => {
  it("reads a person", () => {
    const { view } = specificationFor(person());

    assert.deepEqual(view.context, { type: "person", id: PERSON });
  });

  it("reads a place", () => {
    const { view } = specificationFor(place());

    assert.deepEqual(view.context, { type: "location", id: PLACE });
  });

  it("reads an occasion, whose name carries an underscore the schema spells out", () => {
    const occasion = randomUUID();
    const { view } = specificationFor({ scope: { type: "REAL_WORLD_EVENT", id: occasion } });

    assert.deepEqual(view.context, { type: "real_world_event", id: occasion });
  });

  it("refuses an identifier that is not one", () => {
    assert.throws(
      () => specificationFor({ scope: { type: "PERSON", id: "somebody" } }),
      ValidationError,
    );
  });
});

describe("the lens", () => {
  it("defaults to everything when none is named", () => {
    const { view } = specificationFor(person());

    assert.equal(view.perspective, "all");
  });

  it("reads what somebody recorded", () => {
    const { view } = specificationFor({ ...person(), perspective: "AUTHORED" });

    assert.equal(view.perspective, "authored");
  });

  it("reads what somebody took part in", () => {
    const { view } = specificationFor({ ...person(), perspective: "PARTICIPATED" });

    assert.equal(view.perspective, "participated");
  });

  it("refuses a lens only a person has, asked of a place", () => {
    // Refused rather than quietly answered as everything: a request that meant
    // something other than it said would be worse than one that failed.
    assert.throws(() => specificationFor({ ...place(), perspective: "AUTHORED" }), ValidationError);
  });
});

describe("narrowing", () => {
  it("carries the filters a request names", () => {
    const { view } = specificationFor({ ...person(), filters: { locationId: PLACE } });

    assert.deepEqual(view.filters, { locationId: PLACE });
  });

  it("treats a filter left null as one not asked for", () => {
    const { view } = specificationFor({
      ...person(),
      filters: { locationId: null, realWorldEventId: null, authorUserId: null },
    });

    assert.deepEqual(view.filters, {});
  });

  it("refuses a filter naming the same kind of thing as the scope", () => {
    // Filtering a place's Timeline by that place says nothing, and by another
    // can never hold anything.
    assert.throws(
      () => specificationFor({ ...place(), filters: { locationId: PLACE } }),
      ValidationError,
    );
  });
});

describe("the stretch of history", () => {
  it("reads the whole of it when no range is named", () => {
    const { view } = specificationFor(person());

    assert.equal(view.range, undefined);
  });

  it("reads a fixed span as the instants it always meant", () => {
    const { view } = specificationFor({
      ...person(),
      range: { fixed: { from: new Date("1969-07-01T00:00:00Z"), to: new Date("1969-08-01T00:00:00Z") } },
    });

    assert.deepEqual(view.range, {
      kind: "fixed",
      from: "1969-07-01T00:00:00.000Z",
      to: "1969-08-01T00:00:00.000Z",
    });
  });

  it("keeps a rolling window as a definition rather than the dates it resolves to", () => {
    // What makes "the last thirty days" go on meaning the thirty days before
    // whenever it is next asked, rather than silently becoming a fixed span.
    const { view } = specificationFor({
      ...person(),
      range: { rolling: { unit: "DAY", count: 30 } },
    });

    assert.deepEqual(view.range, { kind: "rolling", unit: "day", count: 30 });
  });

  it("reads the other units a window is counted in", () => {
    const months = specificationFor({ ...person(), range: { rolling: { unit: "MONTH", count: 6 } } });
    const years = specificationFor({ ...person(), range: { rolling: { unit: "YEAR", count: 2 } } });

    assert.deepEqual(months.view.range, { kind: "rolling", unit: "month", count: 6 });
    assert.deepEqual(years.view.range, { kind: "rolling", unit: "year", count: 2 });
  });

  it("refuses a range that is both kinds at once", () => {
    assert.throws(
      () =>
        specificationFor({
          ...person(),
          range: {
            fixed: { from: new Date("1969-07-01T00:00:00Z"), to: new Date("1969-08-01T00:00:00Z") },
            rolling: { unit: "DAY", count: 30 },
          },
        }),
      ValidationError,
    );
  });

  it("refuses a range naming no stretch of time", () => {
    // Likelier a client that dropped a field than somebody asking for the whole
    // of history the long way, which leaving the range out already means.
    assert.throws(() => specificationFor({ ...person(), range: {} }), ValidationError);
  });

  it("refuses a window counted back further than the ceiling", () => {
    assert.throws(
      () => specificationFor({ ...person(), range: { rolling: { unit: "YEAR", count: 1001 } } }),
      ValidationError,
    );
  });
});

describe("where the reader is", () => {
  it("opens at the head when no paging is asked for", () => {
    const { view, from } = specificationFor(person());

    assert.equal(view.direction, "older");
    assert.equal(view.limit, 50);
    assert.equal(from, undefined);
  });

  it("walks into the past with first and after", () => {
    const position = at("2014-05-01T00:00:00Z");
    const { view, from } = specificationFor(person(), { first: 20, after: position });

    assert.equal(view.direction, "older");
    assert.equal(view.limit, 20);
    assert.deepEqual(from, position);
  });

  it("walks towards the present with last and before", () => {
    const position = at("2014-05-01T00:00:00Z");
    const { view, from } = specificationFor(person(), { last: 20, before: position });

    assert.equal(view.direction, "newer");
    assert.equal(view.limit, 20);
    assert.deepEqual(from, position);
  });

  it("takes a count without a cursor as the end the direction implies", () => {
    const { view, from } = specificationFor(person(), { last: 5 });

    assert.equal(view.direction, "newer");
    assert.equal(from, undefined);
  });

  it("refuses both ends of a page at once", () => {
    assert.throws(() => specificationFor(person(), { first: 5, last: 5 }), ValidationError);
  });

  it("refuses two cursors", () => {
    assert.throws(
      () => specificationFor(person(), { after: at("2014-05-01T00:00:00Z"), before: at("2015-05-01T00:00:00Z") }),
      ValidationError,
    );
  });

  it("refuses a count paired with the other end's cursor", () => {
    // Ambiguous rather than merely unusual: which end was meant decides which
    // half of somebody's history comes back.
    assert.throws(
      () => specificationFor(person(), { first: 5, before: at("2014-05-01T00:00:00Z") }),
      ValidationError,
    );
  });

  it("treats paging arguments left null as absent", () => {
    const { view, from } = specificationFor(person(), {
      first: null,
      after: null,
      last: null,
      before: null,
    });

    assert.equal(view.direction, "older");
    assert.equal(view.limit, 50);
    assert.equal(from, undefined);
  });

  it("refuses a page larger than the ceiling", () => {
    // The bound the contract already carries, so one request cannot ask for a
    // life. Reached through the translation rather than restated beside it.
    assert.throws(() => specificationFor(person(), { first: 201 }), ValidationError);
  });

  it("refuses a page of none", () => {
    assert.throws(() => specificationFor(person(), { first: 0 }), ValidationError);
  });

  it("refuses a page of a fraction", () => {
    assert.throws(() => specificationFor(person(), { first: 1.5 }), ValidationError);
  });
});

describe("the refusal", () => {
  it("says what was wrong rather than that something was", () => {
    const refusal = (): void => {
      specificationFor({ ...place(), perspective: "AUTHORED" });
    };

    assert.throws(refusal, (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.code, "VALIDATION_FAILED");
      assert.ok(error.message.length > 0);

      return true;
    });
  });

  it("names the author filter that clashes with a person's own scope", () => {
    assert.throws(
      () => specificationFor({ ...person(), filters: { authorUserId: SOMEBODY } }),
      ValidationError,
    );
  });
});
