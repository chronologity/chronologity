import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  DERIVATION_VERSION,
  viewSpecificationSchema,
  type ViewSpecification,
} from "./view-specification.js";

/**
 * What a Timeline request is.
 *
 * This object will be persisted by Saved Views and reopened against an engine
 * nobody has written yet, so what matters is not that it parses but that it
 * *keeps its meaning*: a rolling range that stays rolling, a version that can be
 * read by a later reader, and a refusal wherever a field would otherwise mean
 * something quietly different from what it says.
 */

const PERSON = randomUUID();
const PLACE = randomUUID();

const view = (over: Record<string, unknown> = {}) => ({
  context: { type: "person", id: PERSON },
  ...over,
});

const parse = (input: Record<string, unknown>) => viewSpecificationSchema.parse(input);

const issuesFor = (input: Record<string, unknown>): readonly string[] => {
  const result = viewSpecificationSchema.safeParse(input);

  return result.success ? assert.fail("expected the specification to be refused") : result.error.issues.map((issue) => issue.message);
};

describe("a view specification", () => {
  it("needs only what it is about", () => {
    // Everything else has a defensible default. A view of somebody's history
    // with no range, no zoom and no position is their whole Timeline from the
    // newest end, which is what opening it means.
    const parsed = parse(view());

    assert.equal(parsed.context.type, "person");
    assert.equal(parsed.perspective, "all");
    assert.equal(parsed.direction, "older");
    assert.equal(parsed.limit, 50);
    assert.equal(parsed.derivationVersion, DERIVATION_VERSION);
    assert.deepEqual(parsed.filters, {});
  });

  it("survives being written down and read back", () => {
    // The property the whole object exists for: a Saved View stores this and
    // reopens it later, so anything lost in the round trip is a view that
    // reopens as something else.
    const original = parse(
      view({
        perspective: "participated",
        range: { kind: "fixed", from: "1990-01-01T00:00:00.000Z", to: "1999-12-31T23:59:59.000Z" },
        zoom: "decade",
        filters: { locationId: PLACE },
        position: { anchoredAt: "1994-06-01T00:00:00.000Z", cursor: "abc" },
        limit: 25,
        direction: "newer",
      }),
    );

    const returned = parse(JSON.parse(JSON.stringify(original)) as Record<string, unknown>);

    assert.deepEqual(returned, original);
  });

  describe("perspective", () => {
    it("distinguishes what somebody recorded from what they were part of", () => {
      for (const perspective of ["all", "authored", "participated"]) {
        assert.equal(parse(view({ perspective })).perspective, perspective);
      }
    });

    it("refuses a lens a place cannot have", () => {
      // Nothing about a place distinguishes recording from taking part.
      // Refused rather than ignored: a saved view that quietly meant something
      // else than it said would be worse than one that failed to open.
      for (const type of ["location", "real_world_event"]) {
        const issues = issuesFor({
          context: { type, id: PLACE },
          perspective: "authored",
        });

        assert.ok(
          issues.some((issue) => /only a person's timeline/i.test(issue)),
          `${type} accepted a perspective it cannot have`,
        );
      }

      assert.equal(parse({ context: { type: "location", id: PLACE } }).perspective, "all");
    });
  });

  describe("temporal range", () => {
    it("keeps a fixed range fixed", () => {
      const range = {
        kind: "fixed",
        from: "1969-07-16T00:00:00.000Z",
        to: "1969-07-24T23:59:59.000Z",
      };

      assert.deepEqual(parse(view({ range })).range, range);
    });

    it("stores what a rolling range means, not what it resolved to", () => {
      // The mistake this exists to prevent: "the last thirty days" saved in
      // June and reopened in December must mean December's thirty days. A
      // specification that had resolved to dates would have become a fixed
      // range silently, and nothing afterwards could tell.
      const parsed = parse(view({ range: { kind: "rolling", unit: "day", count: 30 } }));

      assert.deepEqual(parsed.range, { kind: "rolling", unit: "day", count: 30 });
      assert.equal("from" in (parsed.range ?? {}), false, "a rolling range resolved to dates");
    });

    it("refuses a range that is neither", () => {
      assert.ok(issuesFor(view({ range: { kind: "since-i-last-looked" } })).length > 0);
    });

    it("bounds how far back a rolling range may count", () => {
      assert.equal(parse(view({ range: { kind: "rolling", unit: "year", count: 1000 } })).range?.kind, "rolling");
      assert.ok(issuesFor(view({ range: { kind: "rolling", unit: "day", count: 0 } })).length > 0);
      assert.ok(issuesFor(view({ range: { kind: "rolling", unit: "day", count: 1001 } })).length > 0);
    });
  });

  describe("filters", () => {
    it("narrows within a context", () => {
      const parsed = parse(view({ filters: { locationId: PLACE } }));

      assert.equal(parsed.filters.locationId, PLACE);
    });

    it("refuses one that names what the view is already about", () => {
      // Filtering a place's Timeline by that place says nothing; by a different
      // place it can never hold anything. Both are likelier to be a mistake.
      const cases = [
        [{ type: "person", id: PERSON }, { authorUserId: randomUUID() }],
        [{ type: "location", id: PLACE }, { locationId: randomUUID() }],
        [{ type: "real_world_event", id: PLACE }, { realWorldEventId: randomUUID() }],
      ] as const;

      for (const [context, filters] of cases) {
        assert.ok(
          issuesFor({ context, filters }).some((issue) => /same kind of thing/i.test(issue)),
          `${context.type} accepted a filter naming its own kind`,
        );
      }
    });

    it("refuses a filter it does not know", () => {
      // An unknown filter must not be dropped in silence: a saved view asking
      // to be narrowed, opening unnarrowed, shows more history than its owner
      // asked for.
      const parsed = viewSpecificationSchema.safeParse(view({ filters: { mood: "happy" } }));

      assert.equal(parsed.success, false, "an unknown filter was accepted");
    });
  });

  describe("version", () => {
    it("defaults to the current one", () => {
      assert.equal(parse(view()).derivationVersion, DERIVATION_VERSION);
    });

    it("keeps a version it was given", () => {
      // Read rather than refused. Unlike a cursor, whose loss costs a restart,
      // this may be somebody's saved view — and refusing it is that view
      // failing to open, which `saved-views.md` asks be a migration instead.
      assert.equal(parse(view({ derivationVersion: 1 })).derivationVersion, 1);
    });

    it("refuses a version that is not one", () => {
      for (const derivationVersion of [0, -1, 1.5, "1"]) {
        assert.ok(
          issuesFor(view({ derivationVersion })).length > 0,
          `${String(derivationVersion)} was accepted as a version`,
        );
      }
    });
  });

  describe("what it will not carry", () => {
    it("has no context type nothing can resolve", () => {
      // A subject and a Collection are named as possible in the product
      // document and neither exists. Absent rather than stubbed: a context type
      // resolving to nothing is a saved view that cannot open.
      for (const type of ["subject", "collection", "moment"]) {
        assert.ok(issuesFor({ context: { type, id: PERSON } }).length > 0, `${type} was accepted`);
      }
    });

    it("bounds what one request may ask for", () => {
      assert.equal(parse(view({ limit: 200 })).limit, 200);
      assert.ok(issuesFor(view({ limit: 201 })).length > 0, "a request asked for more than a page");
    });
  });
});

/** The type is exported and usable, which a consumer will need. */
const _typed: ViewSpecification = viewSpecificationSchema.parse({
  context: { type: "person", id: PERSON },
});
void _typed;
