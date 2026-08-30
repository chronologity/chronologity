import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  describeAccount,
  describeComment,
  describeMoment,
  describePerson,
  describeReaction,
  describeSavedView,
} from "./export-document.js";

/** Values that must never reach a file somebody downloads. */
const SECRET = {
  email: "someone@example.test",
  identityId: "11111111-1111-1111-1111-111111111111",
  userId: "22222222-2222-2222-2222-222222222222",
  storageKey: "uploads/22222222/33333333/original",
};

const account = {
  handle: "alex",
  displayName: "Alex Mercer",
  biography: "A biography",
  createdAt: new Date("2020-01-01T00:00:00Z"),
  dateOfBirth: "1990-04-12",
  preferences: {
    autoplayVideos: true,
    autoplaySound: false,
    locale: "en-GB",
    timeZone: "Europe/London",
    reducedMotion: false,
  },
  email: SECRET.email,
  identityId: SECRET.identityId,
};

const moment = {
  momentId: "44444444-4444-4444-4444-444444444444",
  caption: "A caption",
  occurrenceStart: new Date("1998-06-01T00:00:00Z"),
  occurrenceEnd: new Date("1998-08-31T23:59:59Z"),
  occurrencePrecision: "month",
  occurrenceOffsetMinutes: 60,
  visibility: "public",
  createdAt: new Date("2020-02-02T00:00:00Z"),
  place: { name: "A place", precision: "exact", latitude: 51.5, longitude: -0.12 },
  media: [
    {
      uploadId: "55555555-5555-5555-5555-555555555555",
      kind: "image",
      contentType: "image/jpeg",
      byteSize: 1024,
      storageKey: SECRET.storageKey,
    },
  ],
};

const comment = {
  commentId: "66666666-6666-6666-6666-666666666666",
  momentId: moment.momentId,
  body: "Something somebody said",
  createdAt: new Date("2020-03-03T00:00:00Z"),
  author: {
    handle: "sam",
    displayName: "Sam Okafor",
    userId: SECRET.userId,
    email: SECRET.email,
  },
};

const reaction = {
  momentId: moment.momentId,
  kind: "loved",
  createdAt: new Date("2020-04-04T00:00:00Z"),
  by: { handle: "sam", displayName: "Sam Okafor", userId: SECRET.userId, email: SECRET.email },
};

/** Everything the builders produced, as one searchable string. */
const everything = JSON.stringify([
  describeAccount(account),
  describeMoment(moment),
  describeComment(comment),
  describeReaction(reaction),
  describePerson({ handle: "jo", displayName: "Jo Hart", userId: SECRET.userId, email: SECRET.email }),
]);

describe("describeAccount", () => {
  it("keeps what the person chose about themselves", () => {
    const exported = describeAccount(account);

    assert.equal(exported.handle, "alex");
    assert.equal(exported.displayName, "Alex Mercer");
    assert.equal(exported.biography, "A biography");
    assert.equal(exported.dateOfBirth, "1990-04-12");
    assert.equal(exported.joinedAt, "2020-01-01T00:00:00.000Z");
    assert.equal(exported.preferences.timeZone, "Europe/London");
  });

  it("leaves out the address they sign in with", () => {
    // An address is how somebody signs in rather than something that happened
    // to them. An export is a record of a history, not of credentials.
    assert.doesNotMatch(JSON.stringify(describeAccount(account)), /example\.test/);
  });
});

describe("describeMoment", () => {
  it("keeps the occurrence with its precision and its offset", () => {
    // A timestamp stripped of how precisely it was known is a claim the
    // original never made, and `product/privacy.md:776` asks that an export
    // stay useful outside the application.
    const exported = describeMoment(moment);

    assert.equal(exported.occurrence.start, "1998-06-01T00:00:00.000Z");
    assert.equal(exported.occurrence.precision, "month");
    assert.equal(exported.occurrence.offsetMinutes, 60);
  });

  it("keeps the place at the precision it was recorded with", () => {
    assert.deepEqual(describeMoment(moment).place, {
      name: "A place",
      precision: "exact",
      latitude: 51.5,
      longitude: -0.12,
    });
  });

  it("names media by upload rather than by where the file is kept", () => {
    const exported = describeMoment(moment);

    assert.equal(exported.media[0]?.uploadId, "55555555-5555-5555-5555-555555555555");
    assert.equal(exported.media[0]?.contentType, "image/jpeg");
    assert.doesNotMatch(JSON.stringify(exported), /uploads\//);
  });

  it("exports a Moment with no place at all", () => {
    const exported = describeMoment({ ...moment, place: null, media: [] });

    assert.equal(exported.place, null);
    assert.deepEqual(exported.media, []);
  });
});

describe("describeComment and describeReaction", () => {
  it("attribute by handle and display name", () => {
    // What the account could already see in the application, and nothing more.
    assert.deepEqual(describeComment(comment).author, {
      handle: "sam",
      displayName: "Sam Okafor",
    });
    assert.deepEqual(describeReaction(reaction).by, {
      handle: "sam",
      displayName: "Sam Okafor",
    });
  });

  it("keep what was written and when", () => {
    const exported = describeComment(comment);

    assert.equal(exported.body, "Something somebody said");
    assert.equal(exported.writtenAt, "2020-03-03T00:00:00.000Z");
  });
});

describe("describeSavedView", () => {
  const saved = {
    title: "The nineties",
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    lastVisitedAt: new Date("2026-08-30T09:00:00.000Z"),
    specification: { context: { type: "person", id: SECRET.userId }, limit: 50 },
  };

  it("carries the specification verbatim", () => {
    // A Saved View *is* its specification. Summarising it would hand somebody a
    // description of their view rather than the view.
    assert.deepEqual(describeSavedView(saved).view, saved.specification);
  });

  it("says when it was saved and when they last opened it", () => {
    const described = describeSavedView(saved);

    assert.equal(described.savedAt, "2020-01-01T00:00:00.000Z");
    assert.equal(described.lastVisitedAt, "2026-08-30T09:00:00.000Z");
  });

  it("leaves out a visit that never happened", () => {
    assert.equal(describeSavedView({ ...saved, lastVisitedAt: null }).lastVisitedAt, undefined);
  });

  it("carries no count of what was new", () => {
    // Derived, stale by construction, and the one field that can over-report
    // Moments somebody may no longer see. Everywhere else a sweep corrects that
    // within the hour; a downloaded file outlives any correction.
    const described: Record<string, unknown> = { ...describeSavedView(saved) };

    assert.deepEqual(Object.keys(described).sort(), ["lastVisitedAt", "savedAt", "title", "view"]);
  });
});

describe("what no builder may produce", () => {
  it("carries no email address", () => {
    assert.doesNotMatch(everything, /example\.test/);
  });

  it("carries no Identity", () => {
    assert.doesNotMatch(everything, new RegExp(SECRET.identityId));
  });

  it("carries no account identifier for anybody else", () => {
    // An internal identifier would let somebody correlate people across
    // exports in a way the product never let them.
    assert.doesNotMatch(everything, new RegExp(SECRET.userId));
  });

  it("carries no storage key", () => {
    assert.doesNotMatch(everything, new RegExp(SECRET.storageKey));
  });

  it("carries nothing at all that was marked secret", () => {
    // Stated over the whole set rather than one field at a time, so a builder
    // added later is covered by this the moment it appears above.
    for (const [name, value] of Object.entries(SECRET)) {
      assert.equal(everything.includes(value), false, name);
    }
  });
});
