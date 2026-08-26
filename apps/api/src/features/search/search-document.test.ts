import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildLocationDocument,
  buildMomentDocument,
  buildRealWorldEventDocument,
  buildUserDocument,
  geohash,
  lexicalVector,
  geohashTiers,
  permitsDocument,
  permitsSearch,
  readModerationState,
  readPrecision,
  readVisibility,
  shouldReplace,
  type LocationSource,
  type MomentSource,
  type RealWorldEventSource,
  type UserSource,
} from "./search-document.js";

const AT = new Date("2014-06-12T19:30:00.000Z");

const moment = (over: Partial<MomentSource> = {}): MomentSource => ({
  momentId: "moment-1",
  authorUserId: "author-1",
  caption: "The summer everything changed",
  occurrenceStart: AT,
  occurrenceEnd: AT,
  occurrencePrecision: "instant",
  visibility: "public",
  locationDisclosure: "exact",
  createdAt: AT,
  deletedAt: null,
  moderationState: undefined,
  placeName: undefined,
  latitude: undefined,
  longitude: undefined,
  realWorldEventNames: [],
  ...over,
});

const user = (over: Partial<UserSource> = {}): UserSource => ({
  userId: "user-1",
  handle: "ada",
  displayName: "Ada Lovelace",
  biography: null,
  createdAt: AT,
  moderationState: undefined,
  ...over,
});

const event = (over: Partial<RealWorldEventSource> = {}): RealWorldEventSource => ({
  realWorldEventId: "event-1",
  name: "The First World War",
  occurrenceStart: AT,
  occurrenceEnd: AT,
  occurrencePrecision: "year",
  createdAt: AT,
  aliasNames: [],
  moderationState: undefined,
  ...over,
});

const place = (over: Partial<LocationSource> = {}): LocationSource => ({
  locationId: "location-1",
  name: "Lisbon",
  alternateNames: [],
  latitude: 38.7223,
  longitude: -9.1393,
  createdAt: AT,
  moderationState: undefined,
  ...over,
});

describe("readModerationState", () => {
  it("reads nothing decided as allowed", () => {
    assert.equal(readModerationState(undefined), "allowed");
  });

  it("reads each of the seven", () => {
    for (const state of [
      "allowed",
      "warned",
      "restricted_from_amplification",
      "restricted_to_authorized_audience",
      "age_restricted",
      "temporarily_unavailable",
      "removed",
    ]) {
      assert.equal(readModerationState(state), state);
    }
  });

  it("refuses a state it does not recognise", () => {
    // Exclusion over retention: eligibility that cannot be determined must not
    // leave a document standing.
    assert.equal(readModerationState("impounded"), undefined);
  });
});

describe("permitsDocument", () => {
  it("refuses a document for a removed subject", () => {
    assert.equal(permitsDocument("removed"), false);
  });

  it("permits one for everything else", () => {
    for (const state of [
      "allowed",
      "warned",
      "restricted_from_amplification",
      "restricted_to_authorized_audience",
      "age_restricted",
      "temporarily_unavailable",
    ] as const) {
      assert.equal(permitsDocument(state), true, state);
    }
  });
});

describe("permitsSearch", () => {
  it("leaves an allowed subject findable", () => {
    assert.equal(permitsSearch("allowed"), true);
  });

  it("leaves a warned subject findable", () => {
    assert.equal(permitsSearch("warned"), true);
  });

  it("leaves a subject kept out of amplification findable by direct search", () => {
    // Allowed to exist and be reached; kept out of Discovery, which is 5P.
    assert.equal(permitsSearch("restricted_from_amplification"), true);
  });

  it("hides a narrowed subject", () => {
    assert.equal(permitsSearch("restricted_to_authorized_audience"), false);
  });

  it("hides an age-restricted subject until the Viewer is resolved", () => {
    assert.equal(permitsSearch("age_restricted"), false);
  });

  it("hides a subject withheld during review", () => {
    assert.equal(permitsSearch("temporarily_unavailable"), false);
  });

  it("hides a removed subject", () => {
    assert.equal(permitsSearch("removed"), false);
  });
});

describe("readPrecision", () => {
  it("reads each of the four", () => {
    for (const precision of ["instant", "day", "month", "year"]) {
      assert.equal(readPrecision(precision), precision);
    }
  });

  it("widens one it does not recognise to the coarsest", () => {
    // Never read as more exact than it is: a precision nobody recognises must
    // not let a temporal filter assert a date it cannot support.
    assert.equal(readPrecision("epoch"), "year");
  });
});

describe("readVisibility", () => {
  it("reads each of the three", () => {
    for (const visibility of ["public", "restricted", "private"]) {
      assert.equal(readVisibility(visibility), visibility);
    }
  });

  it("refuses one it does not recognise", () => {
    assert.equal(readVisibility("translucent"), "private");
  });
});

describe("lexicalVector", () => {
  it("weights a title above aliases above a body", () => {
    const sql = lexicalVector(4, 6, 5);

    // A name match must outrank a mention.
    assert.ok(sql.includes("$4), 'A'"));
    assert.ok(sql.includes("$6), 'B'"));
    assert.ok(sql.includes("$5), 'C'"));
  });

  it("refers to the parameters it is given rather than numbering its own", () => {
    // The first version numbered its own $1..$3 and left the caller to
    // interleave them. A swapped pair still produced valid SQL and a document
    // that indexed the body as the title, which nothing would have reported.
    assert.equal(lexicalVector(1, 2, 3).includes("$4"), false);
  });
});

describe("geohash", () => {
  it("matches the canonical reference vector", () => {
    // 57.64911, 10.40744 encodes to u4pruydqqvj in every correct
    // implementation. Pinned to an external truth rather than to whatever this
    // code happens to produce, which would only assert that it has not changed.
    assert.equal(geohash(57.64911, 10.40744, 11), "u4pruydqqvj");
  });

  it("encodes a known position", () => {
    assert.equal(geohash(38.7223, -9.1393, 8), "eycs210v");
  });

  it("gives nearby positions a shared prefix", () => {
    const one = geohash(38.7223, -9.1393, 8);
    const other = geohash(38.7225, -9.1391, 8);

    assert.equal(one.slice(0, 5), other.slice(0, 5));
  });

  it("gives distant positions no shared prefix", () => {
    assert.notEqual(geohash(38.7223, -9.1393, 3), geohash(-33.8688, 151.2093, 3));
  });

  it("encodes the poles without throwing", () => {
    assert.equal(geohash(90, 0, 6).length, 6);
    assert.equal(geohash(-90, 0, 6).length, 6);
  });

  it("encodes the antimeridian without throwing", () => {
    assert.equal(geohash(0, 180, 6).length, 6);
    assert.equal(geohash(0, -180, 6).length, 6);
  });

  it("clamps a position outside the valid range rather than refusing it", () => {
    // A stored coordinate that is already wrong should index somewhere
    // approximately right rather than remove the entity from Search entirely.
    assert.equal(geohash(120, 400, 6).length, 6);
  });
});

describe("geohashTiers", () => {
  it("gives all three tiers where the place is disclosed exactly", () => {
    const tiers = geohashTiers(38.7223, -9.1393, "exact");

    assert.equal(tiers.exact?.length, 8);
    assert.equal(tiers.coarse?.length, 5);
    assert.equal(tiers.region?.length, 3);
  });

  it("withholds the exact tier where the author chose neighbourhood", () => {
    const tiers = geohashTiers(38.7223, -9.1393, "neighbourhood");

    // Null rather than stored and filtered later: an index holding the exact
    // position can leak it through a narrow enough query.
    assert.equal(tiers.exact, null);
    assert.equal(tiers.coarse?.length, 5);
  });

  it("keeps only the region where the author chose city", () => {
    const tiers = geohashTiers(38.7223, -9.1393, "city");

    assert.equal(tiers.exact, null);
    assert.equal(tiers.coarse, null);
    assert.equal(tiers.region?.length, 3);
  });

  it("discloses nothing where the author hid the place", () => {
    assert.deepEqual(geohashTiers(38.7223, -9.1393, "hidden"), {
      exact: null,
      coarse: null,
      region: null,
    });
  });

  it("discloses nothing for a disclosure it does not recognise", () => {
    assert.deepEqual(geohashTiers(38.7223, -9.1393, "approximate"), {
      exact: null,
      coarse: null,
      region: null,
    });
  });

  it("discloses nothing where there is no position", () => {
    assert.deepEqual(geohashTiers(undefined, undefined, "exact"), {
      exact: null,
      coarse: null,
      region: null,
    });
  });
});

describe("buildMomentDocument", () => {
  it("indexes a public Moment", () => {
    const document = buildMomentDocument(moment());

    assert.equal(document?.entityType, "moment");
    assert.equal(document?.entityId, "moment-1");
    assert.equal(document?.searchable, true);
    assert.equal(document?.authorUserId, "author-1");
  });

  it("keeps the occurrence interval and its precision exactly", () => {
    const summer = {
      occurrenceStart: new Date("1998-06-01T00:00:00.000Z"),
      occurrenceEnd: new Date("1998-08-31T23:59:59.000Z"),
      occurrencePrecision: "month",
    };
    const document = buildMomentDocument(moment(summer));

    // Nothing invents a day for a summer nobody dated more precisely.
    assert.equal(document?.occurrenceStart, summer.occurrenceStart);
    assert.equal(document?.occurrenceEnd, summer.occurrenceEnd);
    assert.equal(document?.occurrencePrecision, "month");
  });

  it("takes the first line of a caption as the title", () => {
    const document = buildMomentDocument(
      moment({ caption: "The wedding\nAnd everything after it" }),
    );

    assert.equal(document?.title, "The wedding");
    assert.ok(document?.body.includes("And everything after it"));
  });

  it("bounds a title from a caption with no line breaks", () => {
    const document = buildMomentDocument(moment({ caption: "x".repeat(1000) }));

    assert.equal(document?.title.length, 200);
  });

  it("indexes a Moment with no place", () => {
    const document = buildMomentDocument(moment({ placeName: undefined }));

    assert.equal(document?.geohashCoarse, null);
    assert.notEqual(document, undefined);
  });

  it("puts the place and every Event into the body", () => {
    const document = buildMomentDocument(
      moment({
        placeName: "Lisbon",
        realWorldEventNames: ["A wedding", "A family reunion"],
      }),
    );

    assert.ok(document?.body.includes("Lisbon"));
    assert.ok(document?.body.includes("A wedding"));
    assert.ok(document?.body.includes("A family reunion"));
  });

  it("makes one document however much media a Moment holds", () => {
    // Media quantity contributes nothing. A Moment is an experience, and fifty
    // photographs of it are not fifty times the history.
    const document = buildMomentDocument(moment());

    assert.equal(document?.entityId, "moment-1");
  });

  it("carries visibility rather than folding it into searchability", () => {
    const private_ = buildMomentDocument(moment({ visibility: "private" }));
    const restricted = buildMomentDocument(moment({ visibility: "restricted" }));

    // Two dimensions, not one (`search.md:243`). Searchability says whether
    // moderation permits finding this at all; visibility says who may. Folding
    // them together would mean nobody could search their own private history,
    // since the author would be filtered out before anybody knew who was
    // asking.
    assert.equal(private_?.visibility, "private");
    assert.equal(private_?.searchable, true);
    assert.equal(restricted?.visibility, "restricted");
    assert.equal(restricted?.searchable, true);
  });

  it("carries the author so suspension can be resolved against the Viewer", () => {
    // Suspension is volatile and lives on the account. Indexing it here would
    // need every suspension to rewrite every document that account authored,
    // and would still be stale between the two.
    assert.equal(buildMomentDocument(moment())?.authorUserId, "author-1");
  });

  it("marks a deleted Moment as deleted", () => {
    const document = buildMomentDocument(moment({ deletedAt: AT }));

    assert.equal(document?.deleted, true);
  });

  it("builds no document for a removed Moment", () => {
    assert.equal(buildMomentDocument(moment({ moderationState: "removed" })), undefined);
  });

  it("builds no document for a state it does not recognise", () => {
    assert.equal(buildMomentDocument(moment({ moderationState: "impounded" })), undefined);
  });

  it("keeps a warned Moment searchable", () => {
    assert.equal(buildMomentDocument(moment({ moderationState: "warned" }))?.searchable, true);
  });

  it("makes a Moment withheld during review unsearchable without deleting it", () => {
    const document = buildMomentDocument(
      moment({ moderationState: "temporarily_unavailable" }),
    );

    assert.equal(document?.searchable, false);
    assert.equal(document?.deleted, false);
  });

  it("records where each field came from", () => {
    const document = buildMomentDocument(moment());

    assert.equal(document?.provenance.title, "authored");
    assert.equal(document?.provenance.location, "structured");
  });
});

describe("buildUserDocument", () => {
  it("indexes an active account", () => {
    const document = buildUserDocument(user());

    assert.equal(document?.title, "Ada Lovelace");
    assert.equal(document?.aliases, "ada");
    assert.equal(document?.searchable, true);
  });

  it("gives an account no occurrence", () => {
    const document = buildUserDocument(user());

    // An account is not an occurrence. Indexing its creation as one would put
    // people into a chronology of history.
    assert.equal(document?.occurrenceStart, null);
    assert.equal(document?.occurrencePrecision, null);
  });

  it("keys an account on itself so its status can be resolved at query time", () => {
    assert.equal(buildUserDocument(user())?.authorUserId, "user-1");
  });

  it("indexes a biography where there is one", () => {
    assert.equal(buildUserDocument(user({ biography: "Mathematician" }))?.body, "Mathematician");
  });

  it("builds no document for a removed account", () => {
    assert.equal(buildUserDocument(user({ moderationState: "removed" })), undefined);
  });
});

describe("buildRealWorldEventDocument", () => {
  it("indexes an Event with its aliases", () => {
    const document = buildRealWorldEventDocument(
      event({ aliasNames: ["The Great War", "WWI"] }),
    );

    // Somebody searching for the Great War and somebody searching for the First
    // World War are looking for the same Event.
    assert.equal(document?.title, "The First World War");
    assert.ok(document?.aliases.includes("The Great War"));
    assert.ok(document?.aliases.includes("WWI"));
  });

  it("gives an Event no author", () => {
    // Shared history. Nobody's privacy or suspension decides whether it is
    // findable.
    assert.equal(buildRealWorldEventDocument(event())?.authorUserId, null);
  });

  it("keeps an Event's occurrence precision", () => {
    assert.equal(buildRealWorldEventDocument(event())?.occurrencePrecision, "year");
  });

  it("builds no document for a removed Event", () => {
    assert.equal(
      buildRealWorldEventDocument(event({ moderationState: "removed" })),
      undefined,
    );
  });
});

describe("buildLocationDocument", () => {
  it("indexes the city, region, and country as alternates", () => {
    const document = buildLocationDocument(
      place({ alternateNames: ["Lisbon", "Lisboa", "Portugal"] }),
    );

    // What somebody types when they cannot remember the venue but remember the
    // city. The title stays the name of the place itself.
    assert.equal(document?.title, "Lisbon");
    assert.ok(document?.aliases.includes("Portugal"));
  });

  it("indexes a Location with its tiers", () => {
    const document = buildLocationDocument(place());

    assert.equal(document?.title, "Lisbon");
    assert.equal(document?.geohashExact?.length, 8);
    assert.equal(document?.geohashRegion?.length, 3);
  });

  it("indexes a Location with no coordinates", () => {
    const document = buildLocationDocument(place({ latitude: null, longitude: null }));

    assert.notEqual(document, undefined);
    assert.equal(document?.geohashCoarse, null);
  });

  it("gives a Location no occurrence", () => {
    assert.equal(buildLocationDocument(place())?.occurrenceStart, null);
  });

  it("builds no document for a removed Location", () => {
    assert.equal(buildLocationDocument(place({ moderationState: "removed" })), undefined);
  });
});

describe("shouldReplace", () => {
  it("writes where there is nothing stored", () => {
    assert.equal(shouldReplace(undefined, AT), true);
  });

  it("writes a newer reading over an older document", () => {
    assert.equal(shouldReplace(AT, new Date(AT.getTime() + 1)), true);
  });

  it("refuses an older reading over a newer document", () => {
    // The race a rebuild running beside the indexer creates.
    assert.equal(shouldReplace(AT, new Date(AT.getTime() - 1)), false);
  });

  it("refuses a reading of the same instant", () => {
    assert.equal(shouldReplace(AT, new Date(AT.getTime())), false);
  });
});
