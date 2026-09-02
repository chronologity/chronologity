import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { testAppConfig } from "../../testing/app-config.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { createReadyUpload } from "../../testing/fixtures.js";
import { LocationRepository } from "../locations/location.repository.js";
import { ModerationRepository } from "../moderation/moderation.repository.js";
import { MomentCommentRepository } from "../moments/moment-comment.repository.js";
import { MomentReactionRepository } from "../moments/moment-reaction.repository.js";
import { MomentRepository } from "../moments/moment.repository.js";
import { MomentService } from "../moments/moment.service.js";
import { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import { FollowRepository } from "../social/follow.repository.js";
import { FollowService } from "../social/follow.service.js";
import { UploadRepository } from "../uploads/upload.repository.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { ParticipationRepository } from "./participation.repository.js";
import { ParticipationService } from "./participation.service.js";

/**
 * Participation, end to end against real infrastructure.
 *
 * The whole of this sub-phase is a surface — who may say somebody was
 * somewhere, who may answer, and what everybody else can see of the asking — so
 * it is driven through HTTP. The rules that decide anything are pure and
 * covered exhaustively next door.
 *
 * Two properties are asserted throughout, and the Moments here are **private on
 * purpose** so that what passes is the rule rather than a default:
 *
 * - being named grants nothing, and
 * - a proposal is visible to the two people in it and to nobody else.
 *
 * Requires `pnpm infra:up`.
 */

const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? "8025"}`;
const config = testAppConfig("participation-integration");

const ADULT = "1990-04-12";
const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

const occurrence = {
  start: "1998-06-01T00:00:00.000Z",
  end: "1998-06-01T00:00:00.000Z",
  precision: "day",
} as const;

describe("participation", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);

    const accounts = new UserRepository(database.dataSource);
    const followRepository = new FollowRepository(database.dataSource);
    const participationRepository = new ParticipationRepository(database.dataSource);

    const moments = new MomentService(
      database.dataSource,
      new MomentRepository(database.dataSource),
      new UploadRepository(database.dataSource),
      new LocationRepository(database.dataSource),
      new RealWorldEventRepository(database.dataSource),
      followRepository,
      accounts,
      new ModerationRepository(database.dataSource),
      new MomentCommentRepository(database.dataSource),
    );

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, accounts, {
        minimumAgeYears: config.minimumAgeYears,
      }),
      moments,
      participations: new ParticipationService(
        database.dataSource,
        participationRepository,
        moments,
        accounts,
        followRepository,
      ),
      // Mounted so blocking can be driven the way it happens, rather than by
      // reaching into the table the block is supposed to write.
      follows: new FollowService(
        database.dataSource,
        followRepository,
        accounts,
        new RealWorldEventRepository(database.dataSource),
        new LocationRepository(database.dataSource),
        undefined,
        new MomentReactionRepository(database.dataSource),
        new MomentCommentRepository(database.dataSource),
        participationRepository,
      ),
    });
  });

  afterAll(async () => {
    await app.close();
    await authentication.close();
    await database.close();
  });

  const authed = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  /** Read the most recent sign-in link Mailpit received for an address. */
  const readLinkFor = async (email: string, timeoutMs = 10_000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await fetch(
        `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      );
      const body = (await response.json()) as { messages?: { ID: string }[] };
      const id = body.messages?.[0]?.ID;

      if (id !== undefined) {
        const message = await fetch(`${MAILPIT}/api/v1/message/${id}`);
        const detail = (await message.json()) as { Text?: string };
        const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(detail.Text ?? "")?.[1];

        if (token !== undefined) {
          return token;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error(`No sign-in link arrived for ${email}`);
  };

  const onboard = async () => {
    const email = uniqueEmail();
    await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
    const session = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token: await readLinkFor(email) },
    });

    assert.equal(session.statusCode, 201, session.body);

    const credentials = session.json();
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(credentials.accessToken),
      payload: { handle: uniqueHandle(), displayName: "Chronicler", dateOfBirth: ADULT },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { accessToken: credentials.accessToken as string, userId: created.json().userId };
  };

  /**
   * Record a Moment, private by default.
   *
   * Private on purpose: the point of the model is that being named in something
   * is not being admitted to it, and a public Moment would let every assertion
   * here pass without the rule ever being consulted.
   */
  const record = async (
    author: { accessToken: string; userId: string },
    visibility: "private" | "public" = "private",
  ) => {
    const uploadId = await createReadyUpload(database.dataSource, author.userId);
    const recorded = await app.inject({
      method: "POST",
      url: "/moments",
      headers: authed(author.accessToken),
      payload: {
        caption: "something that happened",
        occurrence,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
        visibility,
      },
    });

    assert.equal(recorded.statusCode, 201, recorded.body);

    return recorded.json().momentId as string;
  };

  const propose = async (
    creator: { accessToken: string },
    momentId: string,
    namedUserId: string,
  ) =>
    app.inject({
      method: "POST",
      url: `/moments/${momentId}/participants`,
      headers: authed(creator.accessToken),
      payload: { userId: namedUserId },
    });

  describe("proposing and answering", () => {
    it("records somebody as having been there once they agree", async () => {
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator);

      const proposed = await propose(creator, momentId, named.userId);

      assert.equal(proposed.statusCode, 201, proposed.body);
      assert.equal(proposed.json().status, "proposed");

      const accepted = await app.inject({
        method: "POST",
        url: `/participations/${proposed.json().participationId}/accept`,
        headers: authed(named.accessToken),
      });

      assert.equal(accepted.statusCode, 204, accepted.body);

      const mine = await app.inject({
        method: "GET",
        url: "/participations?direction=to-me",
        headers: authed(named.accessToken),
      });

      assert.deepEqual(
        mine.json().items.map((item: { status: string }) => item.status),
        ["accepted"],
      );
    });

    it("lets the named person refuse, and tells the creator so", async () => {
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator);
      const proposed = await propose(creator, momentId, named.userId);

      const rejected = await app.inject({
        method: "POST",
        url: `/participations/${proposed.json().participationId}/reject`,
        headers: authed(named.accessToken),
      });

      assert.equal(rejected.statusCode, 204, rejected.body);

      // Said plainly rather than left as silence. A creator who cannot tell
      // refusal from an unanswered question will ask again outside the product.
      const theirs = await app.inject({
        method: "GET",
        url: "/participations?direction=by-me",
        headers: authed(creator.accessToken),
      });

      assert.deepEqual(
        theirs.json().items.map((item: { status: string }) => item.status),
        ["rejected"],
      );
    });

    it("refuses a second proposal after a rejection, for good", async () => {
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator);
      const proposed = await propose(creator, momentId, named.userId);

      await app.inject({
        method: "POST",
        url: `/participations/${proposed.json().participationId}/reject`,
        headers: authed(named.accessToken),
      });

      const again = await propose(creator, momentId, named.userId);

      assert.equal(again.statusCode, 400, again.body);
    });

    it("refuses a second proposal after a withdrawal", async () => {
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator);
      const proposed = await propose(creator, momentId, named.userId);
      const participationId = proposed.json().participationId;

      await app.inject({
        method: "POST",
        url: `/participations/${participationId}/accept`,
        headers: authed(named.accessToken),
      });
      const withdrawn = await app.inject({
        method: "DELETE",
        url: `/participations/${participationId}`,
        headers: authed(named.accessToken),
      });

      assert.equal(withdrawn.statusCode, 204, withdrawn.body);
      assert.equal((await propose(creator, momentId, named.userId)).statusCode, 400);
    });

    it("lets a creator take back an unanswered proposal and ask again", async () => {
      // The one removal that is not a refusal. Nobody refused anything, so it
      // must not spend the single chance the creator has.
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator);
      const proposed = await propose(creator, momentId, named.userId);

      const cancelled = await app.inject({
        method: "DELETE",
        url: `/participations/${proposed.json().participationId}`,
        headers: authed(creator.accessToken),
      });

      assert.equal(cancelled.statusCode, 204, cancelled.body);
      assert.equal((await propose(creator, momentId, named.userId)).statusCode, 201);
    });

    it("leaves nothing behind when a proposal is taken back", async () => {
      // Invariant 8. A record of a question nobody answered and the asker
      // retracted is a record of the association.
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator);
      const proposed = await propose(creator, momentId, named.userId);

      await app.inject({
        method: "DELETE",
        url: `/participations/${proposed.json().participationId}`,
        headers: authed(creator.accessToken),
      });

      const rows = await database.dataSource.query(
        "SELECT count(*)::int AS count FROM moment_participations WHERE moment_id = $1",
        [momentId],
      );

      assert.equal(rows[0].count, 0);
    });
  });

  describe("who may do what", () => {
    it("refuses somebody who did not record the Moment", async () => {
      const creator = await onboard();
      const stranger = await onboard();
      const named = await onboard();
      const momentId = await record(creator);

      const attempted = await propose(stranger, momentId, named.userId);

      // Reported as absence: a Moment that is not yours must not be probed for.
      assert.equal(attempted.statusCode, 404, attempted.body);
    });

    it("refuses a creator naming themselves", async () => {
      const creator = await onboard();
      const momentId = await record(creator);

      assert.equal((await propose(creator, momentId, creator.userId)).statusCode, 400);
    });

    it("refuses a creator answering on the named person's behalf", async () => {
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator);
      const proposed = await propose(creator, momentId, named.userId);

      const answered = await app.inject({
        method: "POST",
        url: `/participations/${proposed.json().participationId}/accept`,
        headers: authed(creator.accessToken),
      });

      assert.equal(answered.statusCode, 404, answered.body);
    });

    it("refuses a stranger answering", async () => {
      const creator = await onboard();
      const named = await onboard();
      const stranger = await onboard();
      const momentId = await record(creator);
      const proposed = await propose(creator, momentId, named.userId);

      const answered = await app.inject({
        method: "POST",
        url: `/participations/${proposed.json().participationId}/accept`,
        headers: authed(stranger.accessToken),
      });

      assert.equal(answered.statusCode, 404, answered.body);
    });

    it("refuses a creator removing a participation somebody accepted", async () => {
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator);
      const proposed = await propose(creator, momentId, named.userId);
      const participationId = proposed.json().participationId;

      await app.inject({
        method: "POST",
        url: `/participations/${participationId}/accept`,
        headers: authed(named.accessToken),
      });

      const removed = await app.inject({
        method: "DELETE",
        url: `/participations/${participationId}`,
        headers: authed(creator.accessToken),
      });

      // That record belongs to the person who confirmed it.
      assert.equal(removed.statusCode, 404, removed.body);
    });

    it("distinguishes already answered from not yours", async () => {
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator);
      const proposed = await propose(creator, momentId, named.userId);
      const participationId = proposed.json().participationId;

      await app.inject({
        method: "POST",
        url: `/participations/${participationId}/accept`,
        headers: authed(named.accessToken),
      });

      const twice = await app.inject({
        method: "POST",
        url: `/participations/${participationId}/accept`,
        headers: authed(named.accessToken),
      });

      // 400 rather than 404: it is theirs, and it is too late. Telling them
      // otherwise would be a lie about their own history.
      assert.equal(twice.statusCode, 400, twice.body);
    });

    it("refuses a request with no session", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/participations",
      });

      assert.equal(response.statusCode, 401);
    });
  });

  describe("what a proposal discloses", () => {
    it("shows nothing to a third party who can read the Moment", async () => {
      // The decision the whole model rests on. A public Moment, so the reader
      // is entitled to everything the Moment says — and still not to this.
      const creator = await onboard();
      const named = await onboard();
      const reader = await onboard();
      const momentId = await record(creator, "public");

      await propose(creator, momentId, named.userId);

      const participants = await app.inject({
        method: "GET",
        url: `/moments/${momentId}/participants`,
        headers: authed(reader.accessToken),
      });

      assert.equal(participants.statusCode, 200, participants.body);
      assert.deepEqual(participants.json().participants, []);
    });

    it("names somebody only once they have agreed", async () => {
      const creator = await onboard();
      const named = await onboard();
      const reader = await onboard();
      const momentId = await record(creator, "public");
      const proposed = await propose(creator, momentId, named.userId);

      await app.inject({
        method: "POST",
        url: `/participations/${proposed.json().participationId}/accept`,
        headers: authed(named.accessToken),
      });

      const participants = await app.inject({
        method: "GET",
        url: `/moments/${momentId}/participants`,
        headers: authed(reader.accessToken),
      });

      assert.equal(participants.json().participants.length, 1);
      assert.equal(participants.json().participants[0].user.userId, named.userId);
    });

    it("tells somebody who cannot read the Moment that they were named", async () => {
      // Being named in what you cannot see. They learn who asked and when it
      // happened, and nothing the Moment says.
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator);

      await propose(creator, momentId, named.userId);

      const unreadable = await app.inject({
        method: "GET",
        url: `/moments/${momentId}`,
        headers: authed(named.accessToken),
      });

      assert.equal(unreadable.statusCode, 404, "the Moment must stay unreadable");

      const mine = await app.inject({
        method: "GET",
        url: "/participations?direction=to-me",
        headers: authed(named.accessToken),
      });

      assert.equal(mine.json().items.length, 1);
      assert.equal(mine.json().items[0].momentId, momentId);
    });

    it("grants nothing on acceptance", async () => {
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator);
      const proposed = await propose(creator, momentId, named.userId);

      await app.inject({
        method: "POST",
        url: `/participations/${proposed.json().participationId}/accept`,
        headers: authed(named.accessToken),
      });

      const after = await app.inject({
        method: "GET",
        url: `/moments/${momentId}`,
        headers: authed(named.accessToken),
      });

      assert.equal(after.statusCode, 404, "accepting admitted them to the Moment");
    });

    it("keeps the participant list behind the Moment's own rule", async () => {
      const creator = await onboard();
      const stranger = await onboard();
      const momentId = await record(creator);

      const participants = await app.inject({
        method: "GET",
        url: `/moments/${momentId}/participants`,
        headers: authed(stranger.accessToken),
      });

      assert.equal(participants.statusCode, 404, participants.body);
    });
  });

  describe("refusing to be asked", () => {
    it("stops the next proposal, and says nothing about why", async () => {
      const creator = await onboard();
      const named = await onboard();

      const refused = await app.inject({
        method: "POST",
        url: `/users/${creator.userId}/participation-refusal`,
        headers: authed(named.accessToken),
      });

      assert.equal(refused.statusCode, 204, refused.body);

      const momentId = await record(creator);
      const attempted = await propose(creator, momentId, named.userId);

      // Exactly what an account that does not exist would answer. A refusal
      // exists so somebody can stop being asked, and saying so hands the asker
      // what they need to ask another way.
      assert.equal(attempted.statusCode, 404, attempted.body);
      assert.match(attempted.json().message, /no such user/i);
    });

    it("lists only who you refused, never who refused you", async () => {
      const creator = await onboard();
      const named = await onboard();

      await app.inject({
        method: "POST",
        url: `/users/${creator.userId}/participation-refusal`,
        headers: authed(named.accessToken),
      });

      const theirs = await app.inject({
        method: "GET",
        url: "/participation-refusals",
        headers: authed(named.accessToken),
      });
      const creators = await app.inject({
        method: "GET",
        url: "/participation-refusals",
        headers: authed(creator.accessToken),
      });

      assert.deepEqual(
        theirs.json().items.map((item: { user: { userId: string } }) => item.user.userId),
        [creator.userId],
      );
      assert.deepEqual(creators.json().items, [], "the refused person can see the refusal");
    });

    it("lets somebody be asked again once the refusal is lifted", async () => {
      const creator = await onboard();
      const named = await onboard();

      await app.inject({
        method: "POST",
        url: `/users/${creator.userId}/participation-refusal`,
        headers: authed(named.accessToken),
      });
      await app.inject({
        method: "DELETE",
        url: `/users/${creator.userId}/participation-refusal`,
        headers: authed(named.accessToken),
      });

      const momentId = await record(creator);

      assert.equal((await propose(creator, momentId, named.userId)).statusCode, 201);
    });
  });

  describe("blocking", () => {
    it("refuses a proposal across a block, as though the account were absent", async () => {
      const creator = await onboard();
      const named = await onboard();

      await app.inject({
        method: "POST",
        url: `/users/${creator.userId}/block`,
        headers: authed(named.accessToken),
      });

      const momentId = await record(creator);
      const attempted = await propose(creator, momentId, named.userId);

      assert.equal(attempted.statusCode, 404, attempted.body);
    });

    it("settles an unanswered proposal, permanently", async () => {
      // A block is a refusal and a stronger one than a rejection. Unblocking
      // restores nothing, exactly as it restores no severed reaction.
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator);

      await propose(creator, momentId, named.userId);

      await app.inject({
        method: "POST",
        url: `/users/${creator.userId}/block`,
        headers: authed(named.accessToken),
      });

      const mine = await app.inject({
        method: "GET",
        url: "/participations?direction=to-me",
        headers: authed(named.accessToken),
      });

      assert.deepEqual(
        mine.json().items.map((item: { status: string }) => item.status),
        ["rejected"],
        "a blocked creator's question was left in their list",
      );

      await app.inject({
        method: "DELETE",
        url: `/users/${creator.userId}/block`,
        headers: authed(named.accessToken),
      });

      assert.equal(
        (await propose(creator, momentId, named.userId)).statusCode,
        400,
        "unblocking let the proposal be made again",
      );
    });

    it("leaves an accepted participation standing", async () => {
      // A historical fact somebody consented to, not a tally. Blocking is not
      // historical erasure.
      const creator = await onboard();
      const named = await onboard();
      const momentId = await record(creator, "public");
      const proposed = await propose(creator, momentId, named.userId);

      await app.inject({
        method: "POST",
        url: `/participations/${proposed.json().participationId}/accept`,
        headers: authed(named.accessToken),
      });
      await app.inject({
        method: "POST",
        url: `/users/${creator.userId}/block`,
        headers: authed(named.accessToken),
      });

      const rows = await database.dataSource.query(
        "SELECT status FROM moment_participations WHERE moment_id = $1",
        [momentId],
      );

      assert.deepEqual(
        rows.map((row: { status: string }) => row.status),
        ["accepted"],
      );
    });
  });
});
