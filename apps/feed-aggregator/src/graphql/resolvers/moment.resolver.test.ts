import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import type {
  AuthorizedMoment,
  MomentReadModel,
  MomentRow,
} from "../../read-models/postgres/moment-read-model.js";
import type { GraphQLContext } from "../context/graphql-context.js";
import { mediaTypeResolver, momentFields, momentQueries } from "./moment.resolver.js";

/**
 * The Moment resolvers.
 *
 * One property is worth more than the rest here: **a field beneath a Moment
 * never authorizes it again**. The API cannot avoid re-proving access, because
 * each of its endpoints is a separate request; a GraphQL tree that copied that
 * shape would prove one fact four times, with four chances for one of them to
 * disagree. The read model below fails loudly if a field tries.
 */

const VIEWER = randomUUID();
const AUTHOR = randomUUID();
const MOMENT = randomUUID();

const row = (over: Partial<MomentRow> = {}): MomentRow =>
  ({
    moment_id: MOMENT,
    author_user_id: AUTHOR,
    caption: "a caption",
    occurrence_start: new Date("1998-07-04T19:30:00.000Z"),
    occurrence_end: new Date("1998-07-04T19:30:00.000Z"),
    occurrence_precision: "instant",
    occurrence_offset_minutes: 0,
    visibility: "public",
    location_disclosure: "exact",
    reactions_enabled: true,
    comment_policy: "anyone",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    handle: "somebody",
    display_name: "Somebody",
    biography: null,
    author_created_at: new Date("2020-01-01T00:00:00.000Z"),
    location_id: null,
    location_name: null,
    latitude: null,
    longitude: null,
    location_precision: null,
    neighbourhood: null,
    city: null,
    region: null,
    country: null,
    country_code: null,
    source_reference: null,
    location_source: null,
    location_created_at: null,
    marked_at: null,
    ...over,
  }) as MomentRow;

/** What the read model was asked, so a test can assert what it was not. */
interface Asked {
  authorizations: number;
  media: number;
  comments: number;
  counts: number;
  reactions: number;
  relationships: number;
}

const contextFor = (found: MomentRow | undefined, asked: Asked): GraphQLContext =>
  ({
    viewer: { kind: "authenticated", identityId: randomUUID(), sessionId: randomUUID(), userId: VIEWER },
    eligibility: {
      forViewer: async () => ({ viewerUserId: VIEWER, isAdult: true }),
    },
    moments: {
      findVisible: async (): Promise<AuthorizedMoment | undefined> => {
        asked.authorizations += 1;

        return found === undefined ? undefined : { row: found, viewerUserId: VIEWER };
      },
      media: async () => {
        asked.media += 1;

        return { rows: [], more: false };
      },
      comments: async () => {
        asked.comments += 1;

        return { rows: [], more: false };
      },
      commentCount: async () => {
        asked.counts += 1;

        return 0;
      },
      reactions: async () => {
        asked.reactions += 1;

        return [];
      },
      relationships: async () => {
        asked.relationships += 1;

        return [];
      },
    } as unknown as MomentReadModel,
  }) as unknown as GraphQLContext;

const nothingAsked = (): Asked => ({
  authorizations: 0,
  media: 0,
  comments: 0,
  counts: 0,
  reactions: 0,
  relationships: 0,
});

describe("Query.moment", () => {
  it("answers a Moment this reader may have", async () => {
    const asked = nothingAsked();

    const moment = await momentQueries.moment(undefined, { id: MOMENT }, contextFor(row(), asked));

    assert.equal(moment?.momentId, MOMENT);
    assert.equal(moment?.caption, "a caption");
  });

  it("answers null when they may not, whatever the reason was", async () => {
    const asked = nothingAsked();

    const moment = await momentQueries.moment(
      undefined,
      { id: MOMENT },
      contextFor(undefined, asked),
    );

    assert.equal(moment, null);
  });

  it("refuses an identifier that is not one, without asking the database", async () => {
    const asked = nothingAsked();

    await assert.rejects(() =>
      momentQueries.moment(undefined, { id: "not-a-moment" }, contextFor(row(), asked)),
    );

    assert.equal(asked.authorizations, 0);
  });

  it("composes everything that came back with the Moment, without a second read", async () => {
    // The author, the place and the significance mark are one-to-one with the
    // Moment, so they cost nothing beyond the columns they arrived in.
    const asked = nothingAsked();

    const moment = await momentQueries.moment(undefined, { id: MOMENT }, contextFor(row(), asked));

    assert.equal(moment?.author.handle, "somebody");
    assert.equal(moment?.personalSignificance.significant, false);
    assert.equal(asked.authorizations, 1);
    assert.equal(asked.media + asked.comments + asked.reactions + asked.relationships, 0);
  });
});

describe("the fields beneath a Moment", () => {
  const openMoment = async (context: GraphQLContext) => {
    const moment = await momentQueries.moment(undefined, { id: MOMENT }, context);

    assert.ok(moment !== null);

    return moment;
  };

  it("never authorizes the Moment a second time", async () => {
    // The property this design exists for. Each field takes the proof as its
    // parent and has nowhere to ask again.
    const asked = nothingAsked();
    const context = contextFor(row(), asked);
    const moment = await openMoment(context);

    await momentFields.media(moment, {}, context);
    await momentFields.comments(moment, {}, context);
    await momentFields.reactions(moment, undefined, context);
    await momentFields.relationships(moment, {}, context);

    assert.equal(asked.authorizations, 1);
  });

  it("costs a statement only for the fields a client selected", async () => {
    const asked = nothingAsked();
    const context = contextFor(row(), asked);
    const moment = await openMoment(context);

    await momentFields.media(moment, {}, context);

    assert.equal(asked.media, 1);
    assert.equal(asked.comments, 0);
    assert.equal(asked.reactions, 0);
    assert.equal(asked.relationships, 0);
  });

  it("counts a discussion only when the count is asked for", async () => {
    // Counting a whole discussion is the most expensive statement here and the
    // least often wanted, so the page does not pay for it.
    const asked = nothingAsked();
    const context = contextFor(row(), asked);
    const moment = await openMoment(context);

    const comments = await momentFields.comments(moment, {}, context);

    assert.equal(asked.comments, 1);
    assert.equal(asked.counts, 0);

    await comments.total();

    assert.equal(asked.counts, 1);
  });

  it("asks nothing when reactions are off, because the answer is already known", async () => {
    const asked = nothingAsked();
    const context = contextFor(row({ reactions_enabled: false }), asked);
    const moment = await openMoment(context);

    const summary = await momentFields.reactions(moment, undefined, context);

    assert.equal(summary.enabled, false);
    assert.equal(asked.reactions, 0);
  });
});

describe("which kind of media a row is", () => {
  it("names a photograph", () => {
    assert.equal(
      mediaTypeResolver.resolveType({
        mediaId: randomUUID(),
        kind: "image",
        width: 1,
        height: 1,
        derivatives: [],
        durationSeconds: null,
      }),
      "Image",
    );
  });

  it("names a video, even when nobody recorded how long it runs", () => {
    // A video whose duration was never established is still a video, and
    // presenting it as a photograph would lose the fact that it plays.
    assert.equal(
      mediaTypeResolver.resolveType({
        mediaId: randomUUID(),
        kind: "video",
        width: null,
        height: null,
        derivatives: [],
        durationSeconds: null,
      }),
      "Video",
    );
  });
});
