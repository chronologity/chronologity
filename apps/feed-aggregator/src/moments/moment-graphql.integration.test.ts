import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, it } from "vitest";
import { SessionRepository } from "../auth/session.repository.js";
import { createReadStore, type ReadStore } from "../read-models/clickhouse/client.js";
import { createDirectory, type Directory } from "../read-models/postgres/client.js";
import { asQueryable } from "../read-models/postgres/queryable.js";
import { buildApp } from "../server/app.js";
import { testAppConfig } from "../testing/app-config.js";
import {
  attachMedia,
  createComment,
  createMoment,
  createPerson,
  createPlace,
  removePeople,
  type Person,
} from "../testing/moment-fixtures.js";

/**
 * Opening a Moment through the contract a client actually speaks.
 *
 * The read model's own suite proves the statements. This proves the rest of the
 * path: that the schema resolves, that a `Cursor` survives being handed back,
 * that a place is reduced before it leaves the process, and that a refusal
 * arrives as a refusal rather than as a service that fell over.
 *
 * It also proves the thing no unit test can: that a Moment somebody may not have
 * is `null` *with no error at all*, so the shape of the response says nothing
 * about which of the reasons applied.
 */

const config = testAppConfig();

let app: FastifyInstance;
let store: ReadStore;
let directory: Directory;
const people: Person[] = [];

const DEPTH = `query Depth($id: ID!) {
  moment(id: $id) {
    momentId
    caption
    occurrence { start end precision }
    occurrenceOffsetMinutes
    visibility
    commentPolicy
    author { userId handle displayName }
    place {
      disclosure
      location { locationId name coordinates { latitude longitude } precision }
      area { neighbourhood city country }
    }
    personalSignificance { momentId significant markedAt }
    reactions { enabled total yours counts { kind count } }
    relationships { relationshipId kind origin unavailable }
  }
}`;

const MEDIA = `query Media($id: ID!, $first: Int, $after: Cursor) {
  moment(id: $id) {
    media(first: $first, after: $after) {
      edges {
        cursor
        node {
          __typename
          mediaId
          width
          height
          derivatives
          ... on Video { durationSeconds }
        }
      }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
}`;

const COMMENTS = `query Comments($id: ID!, $first: Int, $after: Cursor, $thread: ID) {
  moment(id: $id) {
    comments(first: $first, after: $after, thread: $thread) {
      total
      edges {
        cursor
        node {
          commentId
          deleted
          body
          author { handle }
          mentions { userId handle }
          reactions { total yours }
          createdAt
        }
      }
      pageInfo { hasNextPage hasPreviousPage }
    }
  }
}`;

/** Somebody new, with a Session they can read through. */
async function signedInPerson(): Promise<Person & { token: string }> {
  const created = await createPerson(directory.pool);
  const sessionId = randomUUID();

  people.push(created);

  await directory.pool.query(
    `INSERT INTO sessions (session_id, identity_id, created_at, expires_at, revoked_at)
     VALUES ($1, $2, now(), now() + interval '1 hour', NULL)`,
    [sessionId, created.identityId],
  );

  const token = await new SignJWT({ sid: sessionId, uid: created.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(created.identityId)
    .setIssuer(config.auth.issuer)
    .setAudience(config.auth.audience)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(config.auth.jwtSecret);

  return { ...created, token };
}

/**
 * Ask the read contract a question.
 *
 * @param query - The document.
 * @param variables - Its variables.
 * @param token - The credential, or undefined to ask as nobody.
 * @returns The parsed body.
 */
async function ask(
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<{
  data: Record<string, unknown> | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}> {
  const response = await app.inject({
    method: "POST",
    url: "/graphql",
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    payload: { query, variables },
  });

  return response.json();
}

beforeAll(async () => {
  store = createReadStore(config.clickhouse);
  directory = createDirectory(config.database);

  const present = await directory.pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.moments') IS NOT NULL AS exists",
  );

  if (present.rows[0]?.exists !== true) {
    throw new Error("The schema is missing. The API owns it: run `pnpm db:migrate` and try again.");
  }

  app = await buildApp({
    config,
    dependencies: [store, directory],
    graphql: {
      store,
      sessions: new SessionRepository(directory.pool),
      eligibility: new TimelineEligibilityResolver(asQueryable(directory.pool)),
      directory: directory.pool,
    },
  });
});

afterAll(async () => {
  await removePeople(directory.pool, people);
  await app.close();
  await store.close();
  await directory.close();
});

describe("opening a Moment", () => {
  it("composes it in one request", async () => {
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId, {
      caption: "the day the power came back",
    });

    const body = await ask(DEPTH, { id: momentId }, author.token);
    const moment = body.data?.["moment"] as Record<string, unknown>;

    assert.equal(body.errors, undefined);
    assert.equal(moment["momentId"], momentId);
    assert.equal(moment["caption"], "the day the power came back");
    assert.equal(moment["visibility"], "PUBLIC");
    assert.equal(moment["commentPolicy"], "ANYONE");
    assert.deepEqual(moment["occurrence"], {
      start: "1998-07-04T19:30:00.000Z",
      end: "1998-07-04T19:30:00.000Z",
      precision: "INSTANT",
    });
    assert.equal((moment["author"] as Record<string, unknown>)["handle"], author.handle);
  });

  it("answers null, with no error, when the reader may not have it", async () => {
    // The shape of the response must say nothing about which reason applied.
    const author = await signedInPerson();
    const stranger = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId, { visibility: "private" });

    const body = await ask(DEPTH, { id: momentId }, stranger.token);

    assert.equal(body.data?.["moment"], null);
    assert.equal(body.errors, undefined);
  });

  it("answers the same way for a Moment that never existed", async () => {
    const stranger = await signedInPerson();

    const body = await ask(DEPTH, { id: randomUUID() }, stranger.token);

    assert.equal(body.data?.["moment"], null);
    assert.equal(body.errors, undefined);
  });

  it("refuses an identifier that is not one, as a refusal", async () => {
    const stranger = await signedInPerson();

    const body = await ask(DEPTH, { id: "a-moment-please" }, stranger.token);

    assert.equal(body.errors?.[0]?.extensions?.code, "VALIDATION_FAILED");
  });

  it("refuses a request that offered no credential", async () => {
    // A Block is between two accounts, so somebody who could read signed out
    // would have routed around one.
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);

    const body = await ask(DEPTH, { id: momentId }, undefined);

    assert.equal(body.errors?.[0]?.extensions?.code, "AUTHENTICATION_FAILED");
  });
});

describe("where it happened", () => {
  it("gives the author the exact place whatever they chose for everybody else", async () => {
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId, {
      locationDisclosure: "hidden",
    });

    await createPlace(directory.pool, momentId, author.userId);

    const body = await ask(DEPTH, { id: momentId }, author.token);

    assert.equal(body.errors, undefined, JSON.stringify(body.errors));

    const place = (body.data?.["moment"] as Record<string, unknown>)["place"] as Record<
      string,
      unknown
    >;

    assert.equal(place["disclosure"], "EXACT");
    assert.equal((place["location"] as Record<string, unknown>)["name"], "Madison Square Garden");
  });

  it("reduces it to an area for everybody else, with no identifier at all", async () => {
    // The identifier is itself the disclosure: it would let anybody look up
    // exactly what was withheld.
    const author = await signedInPerson();
    const stranger = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId, {
      locationDisclosure: "city",
    });

    await createPlace(directory.pool, momentId, author.userId);

    const body = await ask(DEPTH, { id: momentId }, stranger.token);

    assert.equal(body.errors, undefined, JSON.stringify(body.errors));

    const place = (body.data?.["moment"] as Record<string, unknown>)["place"] as Record<
      string,
      unknown
    >;
    const area = place["area"] as Record<string, unknown>;

    assert.equal(place["disclosure"], "CITY");
    assert.equal(place["location"], null);
    assert.equal(area["city"], "New York");
    assert.equal(area["neighbourhood"], null);
    assert.ok(!JSON.stringify(body).includes("40.75"), "a reduced place carried its coordinates");
  });

  it("says a place is hidden rather than saying there is none", async () => {
    const author = await signedInPerson();
    const stranger = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId, {
      locationDisclosure: "hidden",
    });

    await createPlace(directory.pool, momentId, author.userId);

    const body = await ask(DEPTH, { id: momentId }, stranger.token);

    assert.equal(body.errors, undefined, JSON.stringify(body.errors));

    const place = (body.data?.["moment"] as Record<string, unknown>)["place"] as Record<
      string,
      unknown
    >;

    assert.equal(place["disclosure"], "HIDDEN");
    assert.equal(place["location"], null);
    assert.equal(place["area"], null);
  });

  it("has no place at all when nobody said where", async () => {
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);

    const body = await ask(DEPTH, { id: momentId }, author.token);

    assert.equal((body.data?.["moment"] as Record<string, unknown>)["place"], null);
  });
});

describe("a Moment's media, through the contract", () => {
  it("pages with cursors it issued, and never returns the probe row", async () => {
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);
    const uploads = await attachMedia(directory.pool, momentId, author.userId, 5);

    const first = await ask(MEDIA, { id: momentId, first: 2 }, author.token);
    const firstPage = ((first.data?.["moment"] as Record<string, unknown>)["media"] as {
      edges: { cursor: string; node: { mediaId: string } }[];
      pageInfo: Record<string, unknown>;
    });

    assert.deepEqual(
      firstPage.edges.map((edge) => edge.node.mediaId),
      uploads.slice(0, 2),
    );
    assert.equal(firstPage.pageInfo["hasNextPage"], true);
    assert.equal(firstPage.pageInfo["hasPreviousPage"], false);

    const second = await ask(
      MEDIA,
      { id: momentId, first: 2, after: firstPage.pageInfo["endCursor"] },
      author.token,
    );
    const secondPage = ((second.data?.["moment"] as Record<string, unknown>)["media"] as {
      edges: { node: { mediaId: string } }[];
      pageInfo: Record<string, unknown>;
    });

    assert.deepEqual(
      secondPage.edges.map((edge) => edge.node.mediaId),
      uploads.slice(2, 4),
    );
    assert.equal(secondPage.pageInfo["hasPreviousPage"], true);
  });

  it("tells a photograph from a video", async () => {
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);

    await attachMedia(directory.pool, momentId, author.userId, 1, "video");

    const body = await ask(MEDIA, { id: momentId, first: 5 }, author.token);
    const node = ((body.data?.["moment"] as Record<string, unknown>)["media"] as {
      edges: { node: Record<string, unknown> }[];
    }).edges[0]?.node;

    assert.equal(node?.["__typename"], "Video");
    assert.equal(node?.["durationSeconds"], 12.5);
    assert.deepEqual(node?.["derivatives"], ["THUMBNAIL"]);
  });

  it("exposes no storage key, URL or upload state anywhere in the response", async () => {
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);

    await attachMedia(directory.pool, momentId, author.userId, 1);

    const body = await ask(MEDIA, { id: momentId, first: 5 }, author.token);
    const serialised = JSON.stringify(body);

    for (const leak of ["storage_key", "storageKey", "uploads/", "declared", "ready"]) {
      assert.ok(!serialised.includes(leak), `the response carried ${leak}`);
    }
  });

  it("refuses a cursor from another Moment's media", async () => {
    // Its ordinal would be meaningful here, which is the problem: it would
    // resume a different sequence at a number that happens to exist in this one.
    const author = await signedInPerson();
    const one = await createMoment(directory.pool, author.userId);
    const other = await createMoment(directory.pool, author.userId);

    await attachMedia(directory.pool, one, author.userId, 2);
    await attachMedia(directory.pool, other, author.userId, 2);

    const from = await ask(MEDIA, { id: one, first: 1 }, author.token);
    const cursor = ((from.data?.["moment"] as Record<string, unknown>)["media"] as {
      pageInfo: { endCursor: string };
    }).pageInfo.endCursor;

    const body = await ask(MEDIA, { id: other, first: 1, after: cursor }, author.token);

    assert.equal(body.errors?.[0]?.extensions?.code, "VALIDATION_FAILED");
  });

  it("refuses a cursor this service did not issue", async () => {
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);

    const body = await ask(MEDIA, { id: momentId, first: 1, after: "forged" }, author.token);

    assert.equal(body.errors?.[0]?.extensions?.code, "VALIDATION_FAILED");
    assert.ok(!JSON.stringify(body).includes("base64"));
  });
});

describe("a Moment's discussion, through the contract", () => {
  it("comes back oldest first, with what was said about each comment", async () => {
    const author = await signedInPerson();
    const talker = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);

    await createComment(directory.pool, momentId, talker.userId, {
      body: "first",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const second = await createComment(directory.pool, momentId, talker.userId, {
      body: "second",
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    await directory.pool.query(
      "INSERT INTO comment_reactions (comment_id, user_id, kind, created_at, updated_at) VALUES ($1, $2, 'loved', now(), now())",
      [second, author.userId],
    );

    const body = await ask(COMMENTS, { id: momentId, first: 10 }, author.token);
    const comments = (body.data?.["moment"] as Record<string, unknown>)["comments"] as {
      total: number;
      edges: { node: Record<string, unknown> }[];
    };

    assert.equal(comments.total, 2);
    assert.deepEqual(
      comments.edges.map((edge) => edge.node["body"]),
      ["first", "second"],
    );
    assert.equal(
      (comments.edges[1]?.node["reactions"] as Record<string, unknown>)["yours"],
      "LOVED",
    );
  });

  it("presents a tombstone with neither author nor words", async () => {
    const author = await signedInPerson();
    const talker = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);
    const answered = await createComment(directory.pool, momentId, talker.userId, {
      body: "what they said",
      deleted: true,
    });

    await createComment(directory.pool, momentId, talker.userId, { threadCommentId: answered });

    const body = await ask(COMMENTS, { id: momentId, first: 10 }, author.token);
    const node = ((body.data?.["moment"] as Record<string, unknown>)["comments"] as {
      edges: { node: Record<string, unknown> }[];
    }).edges[0]?.node;

    assert.equal(node?.["deleted"], true);
    assert.equal(node?.["author"], null);
    assert.equal(node?.["body"], null);
    assert.ok(!JSON.stringify(body).includes("what they said"));
  });

  it("reads a thread's replies when one is named", async () => {
    const author = await signedInPerson();
    const talker = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);
    const thread = await createComment(directory.pool, momentId, talker.userId, { body: "top" });

    await createComment(directory.pool, momentId, talker.userId, {
      body: "a reply",
      threadCommentId: thread,
    });

    const body = await ask(COMMENTS, { id: momentId, first: 10, thread }, author.token);
    const comments = (body.data?.["moment"] as Record<string, unknown>)["comments"] as {
      edges: { node: Record<string, unknown> }[];
    };

    assert.deepEqual(
      comments.edges.map((edge) => edge.node["body"]),
      ["a reply"],
    );
  });

  it("pages with the cursors it issued", async () => {
    const author = await signedInPerson();
    const talker = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);

    for (let index = 0; index < 3; index += 1) {
      await createComment(directory.pool, momentId, talker.userId, {
        body: `comment ${index}`,
        createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      });
    }

    const first = await ask(COMMENTS, { id: momentId, first: 2 }, author.token);
    const page = (first.data?.["moment"] as Record<string, unknown>)["comments"] as {
      edges: { cursor: string; node: Record<string, unknown> }[];
      pageInfo: Record<string, unknown>;
    };

    assert.equal(page.pageInfo["hasNextPage"], true);

    const second = await ask(
      COMMENTS,
      { id: momentId, first: 2, after: page.edges[1]?.cursor },
      author.token,
    );
    const rest = (second.data?.["moment"] as Record<string, unknown>)["comments"] as {
      edges: { node: Record<string, unknown> }[];
    };

    assert.deepEqual(
      rest.edges.map((edge) => edge.node["body"]),
      ["comment 2"],
    );
  });
});

describe("what a reader is told about themselves", () => {
  it("reports their own mark, and never anybody else's", async () => {
    const author = await signedInPerson();
    const stranger = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId);

    await directory.pool.query(
      "INSERT INTO moment_personal_significance (moment_id, user_id, marked_at) VALUES ($1, $2, now())",
      [momentId, author.userId],
    );

    const mine = await ask(DEPTH, { id: momentId }, author.token);
    const theirs = await ask(DEPTH, { id: momentId }, stranger.token);

    assert.equal(
      ((mine.data?.["moment"] as Record<string, unknown>)["personalSignificance"] as Record<
        string,
        unknown
      >)["significant"],
      true,
    );
    assert.equal(
      ((theirs.data?.["moment"] as Record<string, unknown>)["personalSignificance"] as Record<
        string,
        unknown
      >)["significant"],
      false,
    );
  });

  it("shows reactions as withheld rather than absent when they are off", async () => {
    // "Reactions are off" and "nobody reacted" are different facts.
    const author = await signedInPerson();
    const momentId = await createMoment(directory.pool, author.userId, {
      reactionsEnabled: false,
    });

    const body = await ask(DEPTH, { id: momentId }, author.token);
    const reactions = (body.data?.["moment"] as Record<string, unknown>)["reactions"] as Record<
      string,
      unknown
    >;

    assert.equal(reactions["enabled"], false);
    assert.deepEqual(reactions["counts"], []);
  });
});
