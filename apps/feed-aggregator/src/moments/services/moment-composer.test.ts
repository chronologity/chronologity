import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import type {
  CommentRow,
  MediaRow,
  MomentRow,
  ReactionCountRow,
  RelationshipRow,
} from "../../read-models/postgres/moment-read-model.js";
import {
  commentConnectionFor,
  mediaConnectionFor,
  momentFor,
  reactionSummaryFor,
  relationshipFor,
  significanceFor,
} from "./moment-composer.js";

/**
 * Rows as a reader receives them.
 *
 * The assertions that matter here are about what is *withheld*: a place reduced
 * to the tier its author chose, a deleted comment that keeps its place in a
 * conversation and loses everything else, and a significance mark that is only
 * ever this reader's own.
 */

const AUTHOR = randomUUID();
const STRANGER = randomUUID();
const MOMENT = randomUUID();

const moment = (over: Partial<MomentRow> = {}): MomentRow => ({
  moment_id: MOMENT,
  author_user_id: AUTHOR,
  caption: "the afternoon it finally stopped raining",
  occurrence_start: new Date("1998-07-04T19:30:00.000Z"),
  occurrence_end: new Date("1998-07-04T19:30:00.000Z"),
  occurrence_precision: "instant",
  occurrence_offset_minutes: 60,
  visibility: "public",
  location_disclosure: "exact",
  reactions_enabled: true,
  comment_policy: "anyone",
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  handle: "somebody",
  display_name: "Somebody",
  biography: null,
  author_created_at: new Date("2020-01-01T00:00:00.000Z"),
  location_id: randomUUID(),
  location_name: "Madison Square Garden",
  latitude: "40.7505",
  longitude: "-73.9934",
  location_precision: "exact",
  neighbourhood: "Midtown",
  city: "New York",
  region: "New York",
  country: "United States",
  country_code: "US",
  source_reference: null,
  location_source: "explicit-selection",
  location_created_at: new Date("2020-01-01T00:00:00.000Z"),
  marked_at: null,
  ...over,
});

describe("a Moment", () => {
  it("presents what it says and when it happened", () => {
    const composed = momentFor(moment(), STRANGER);

    assert.equal(composed.caption, "the afternoon it finally stopped raining");
    assert.equal(composed.occurrence.precision, "INSTANT");
    assert.equal(composed.occurrenceOffsetMinutes, 60);
    assert.equal(composed.visibility, "PUBLIC");
    assert.equal(composed.commentPolicy, "ANYONE");
  });

  it("names its author without saying anything about their account", () => {
    const composed = momentFor(moment(), STRANGER);

    assert.equal(composed.author.userId, AUTHOR);
    assert.equal(composed.author.handle, "somebody");
    assert.ok(!("status" in composed.author));
  });
});

describe("how much of a place a reader is told", () => {
  it("gives the author the exact place whatever they chose for everybody else", () => {
    // A choice about what to tell other people was never a choice to forget it.
    const composed = momentFor(moment({ location_disclosure: "hidden" }), AUTHOR);

    assert.equal(composed.place?.disclosure, "EXACT");
    assert.equal(composed.place?.location?.name, "Madison Square Garden");
  });

  it("gives a stranger the exact place when the author said so", () => {
    const composed = momentFor(moment(), STRANGER);

    assert.equal(composed.place?.disclosure, "EXACT");
    assert.ok(composed.place?.location !== null);
  });

  it("spells the place's own enums the way the schema does", () => {
    // The contract writes these in lowercase and the schema in upper. Composing
    // one as the other is invisible in a unit test and fails at serialisation,
    // which is how it was found: an internal error on `place.disclosure` while
    // every assertion about the composer still passed.
    const composed = momentFor(moment(), STRANGER);

    assert.equal(composed.place?.location?.precision, "EXACT");
  });

  it("drops the identifier and the coordinates below exact", () => {
    // The identifier is itself the disclosure: it would let anybody look up
    // exactly what was withheld.
    const composed = momentFor(moment({ location_disclosure: "neighbourhood" }), STRANGER);

    assert.equal(composed.place?.disclosure, "NEIGHBOURHOOD");
    assert.equal(composed.place?.location, null);
    assert.equal(composed.place?.area?.neighbourhood, "Midtown");
  });

  it("withholds the neighbourhood at city", () => {
    const composed = momentFor(moment({ location_disclosure: "city" }), STRANGER);

    assert.equal(composed.place?.disclosure, "CITY");
    assert.equal(composed.place?.area?.neighbourhood, null);
    assert.equal(composed.place?.area?.city, "New York");
  });

  it("says a place is hidden rather than saying there is none", () => {
    // "Nobody said where" and "you are not being told where" are different
    // facts, and a client should be able to tell them apart.
    const composed = momentFor(moment({ location_disclosure: "hidden" }), STRANGER);

    assert.equal(composed.place?.disclosure, "HIDDEN");
    assert.equal(composed.place?.location, null);
    assert.equal(composed.place?.area, null);
  });

  it("has no place at all when nobody said where", () => {
    const composed = momentFor(moment({ location_id: null }), STRANGER);

    assert.equal(composed.place, null);
  });
});

describe("the significance mark", () => {
  it("reports an unmarked Moment as unmarked rather than unknown", () => {
    assert.deepEqual(significanceFor(moment()), {
      momentId: MOMENT,
      significant: false,
      markedAt: null,
    });
  });

  it("reports when this reader marked it", () => {
    const markedAt = new Date("2026-02-02T00:00:00.000Z");

    assert.deepEqual(significanceFor(moment({ marked_at: markedAt })), {
      momentId: MOMENT,
      significant: true,
      markedAt,
    });
  });
});

describe("how a Moment has been responded to", () => {
  const counted = (kind: string, count: number, mine = false): ReactionCountRow => ({
    kind,
    count,
    mine,
  });

  it("leaves out a kind nobody chose rather than showing a zero", () => {
    const summary = reactionSummaryFor([counted("loved", 3)], true);

    assert.deepEqual(summary.counts, [{ kind: "LOVED", count: 3 }]);
    assert.equal(summary.total, 3);
  });

  it("leaves out a kind only suspended people chose", () => {
    // The statement counts it as zero rather than dropping the row, so that a
    // suspended reader is still told what they themselves chose.
    const summary = reactionSummaryFor([counted("loved", 2), counted("amused", 0)], true);

    assert.deepEqual(
      summary.counts.map((count) => count.kind),
      ["LOVED"],
    );
  });

  it("still tells a suspended reader what they chose", () => {
    // Their own row counts zero for everybody else and is still theirs.
    const summary = reactionSummaryFor([counted("saddened", 0, true)], true);

    assert.deepEqual(summary.counts, []);
    assert.equal(summary.total, 0);
    assert.equal(summary.yours, "SADDENED");
  });

  it("reports your own choice", () => {
    const summary = reactionSummaryFor([counted("loved", 1), counted("amused", 4, true)], true);

    assert.equal(summary.yours, "AMUSED");
  });

  it("withholds the counts when reactions are off, rather than reporting none", () => {
    // "Reactions are off" and "nobody reacted" are different facts, and turning
    // them back on restores the same numbers.
    const summary = reactionSummaryFor([counted("loved", 9)], false);

    assert.equal(summary.enabled, false);
    assert.deepEqual(summary.counts, []);
    assert.equal(summary.total, 0);
    assert.equal(summary.yours, null);
  });
});

describe("a page of media", () => {
  const media = (position: number, over: Partial<MediaRow> = {}): MediaRow => ({
    position,
    upload_id: randomUUID(),
    kind: "image",
    width: 3024,
    height: 4032,
    duration_seconds: null,
    derivatives: ["thumbnail"],
    ...over,
  });

  it("carries the Moment in every cursor, so another Moment's is refused", () => {
    const connection = mediaConnectionFor({ rows: [media(0)], more: false }, MOMENT, false);

    assert.deepEqual(connection.edges[0]?.cursor, { kind: "media", momentId: MOMENT, position: 0 });
  });

  it("runs forwards, so more means further along the sequence", () => {
    const connection = mediaConnectionFor(
      { rows: [media(0), media(1)], more: true },
      MOMENT,
      false,
    );

    assert.equal(connection.pageInfo.hasNextPage, true);
    assert.equal(connection.pageInfo.hasPreviousPage, false);
  });

  it("says there is something behind a page reached from a cursor", () => {
    const connection = mediaConnectionFor({ rows: [media(5)], more: false }, MOMENT, true);

    assert.equal(connection.pageInfo.hasPreviousPage, true);
  });

  it("gives an empty page no ends", () => {
    const connection = mediaConnectionFor({ rows: [], more: false }, MOMENT, false);

    assert.equal(connection.pageInfo.startCursor, null);
    assert.equal(connection.pageInfo.endCursor, null);
  });

  it("reads a video's length back as a number", () => {
    // `numeric` arrives as a string, because a driver that turned it into a
    // float would be choosing precision on the database's behalf.
    const connection = mediaConnectionFor(
      { rows: [media(0, { kind: "video", duration_seconds: "12.500" })], more: false },
      MOMENT,
      false,
    );

    assert.equal(connection.edges[0]?.node.durationSeconds, 12.5);
  });

  it("exposes nothing about the upload itself", () => {
    const connection = mediaConnectionFor({ rows: [media(0)], more: false }, MOMENT, false);
    const node = connection.edges[0]?.node ?? {};

    for (const absent of ["url", "storageKey", "state", "checksum", "failureReason"]) {
      assert.ok(!(absent in node), `media exposed ${absent}`);
    }
  });
});

describe("a page of discussion", () => {
  const comment = (over: Partial<CommentRow> = {}): CommentRow => ({
    comment_id: randomUUID(),
    moment_id: MOMENT,
    author_user_id: STRANGER,
    body: "I remember that day",
    deleted_at: null,
    thread_comment_id: null,
    in_reply_to_comment_id: null,
    created_at: new Date("2026-01-02T00:00:00.000Z"),
    edited_at: null,
    handle: "someone-else",
    display_name: "Someone Else",
    biography: null,
    author_created_at: new Date("2021-01-01T00:00:00.000Z"),
    mentions: null,
    counts: null,
    yours: null,
    ...over,
  });

  it("keeps a deleted comment's place and loses everything else", () => {
    // The replies need something to hang from; nothing else about it is
    // anybody's business.
    const row = comment({ deleted_at: new Date(), body: "what they said" });

    const node = commentConnectionFor({ rows: [row], more: false }, false).edges[0]?.node;

    assert.equal(node?.deleted, true);
    assert.equal(node?.author, null);
    assert.equal(node?.body, null);
    assert.deepEqual(node?.mentions, []);
    assert.equal(node?.createdAt.getTime(), row.created_at.getTime());
  });

  it("carries who a live comment referred to", () => {
    const mentions = [{ userId: AUTHOR, handle: "somebody" }];

    const node = commentConnectionFor(
      { rows: [comment({ mentions })], more: false },
      false,
    ).edges[0]?.node;

    assert.deepEqual(node?.mentions, mentions);
  });

  it("reads nobody mentioned as nobody rather than as missing", () => {
    const node = commentConnectionFor({ rows: [comment()], more: false }, false).edges[0]?.node;

    assert.deepEqual(node?.mentions, []);
  });

  it("summarises how a comment was responded to, including your own", () => {
    const row = comment({ counts: [{ kind: "loved", count: 2 }], yours: "loved" });

    const node = commentConnectionFor({ rows: [row], more: false }, false).edges[0]?.node;

    assert.deepEqual(node?.reactions.counts, [{ kind: "LOVED", count: 2 }]);
    assert.equal(node?.reactions.yours, "LOVED");
  });

  it("keys each cursor on the instant and the identifier together", () => {
    // Two comments written in the same millisecond are broken apart by the
    // identifier, so both have to be in the cursor.
    const row = comment();

    const cursor = commentConnectionFor({ rows: [row], more: false }, false).edges[0]?.cursor;

    assert.deepEqual(cursor, {
      kind: "comment",
      createdAt: row.created_at,
      commentId: row.comment_id,
    });
  });
});

describe("what a Moment is connected to", () => {
  const relationship = (over: Partial<RelationshipRow> = {}): RelationshipRow => ({
    relationship_id: randomUUID(),
    source_moment_id: MOMENT,
    target_moment_id: randomUUID(),
    kind: "led_to",
    origin: "asserted",
    asserted_by_user_id: AUTHOR,
    created_at: new Date("2026-01-03T00:00:00.000Z"),
    unavailable: false,
    ...over,
  });

  it("keeps who claimed it", () => {
    // A relationship is always something somebody said, never something derived
    // from chronological order.
    const composed = relationshipFor(relationship());

    assert.equal(composed.assertedByUserId, AUTHOR);
    assert.equal(composed.origin, "ASSERTED");
    assert.equal(composed.kind, "LED_TO");
  });

  it("marks a far end moderation withheld, and says nothing more about it", () => {
    const composed = relationshipFor(relationship({ unavailable: true }));

    assert.equal(composed.unavailable, true);

    for (const absent of ["caption", "author", "place", "media"]) {
      assert.ok(!(absent in composed), `a relationship exposed ${absent}`);
    }
  });

  it("offers no confidence score", () => {
    // Human histories are not improved by false mathematical precision.
    const composed = relationshipFor(relationship());

    for (const absent of ["confidence", "score", "probability"]) {
      assert.ok(!(absent in composed), `a relationship exposed ${absent}`);
    }
  });
});
