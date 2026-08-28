import assert from "node:assert/strict";
import { testAppConfig } from "../../testing/app-config.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { createReadyUpload } from "../../testing/fixtures.js";
import { AuthorizationRepository } from "../authorization/authorization.repository.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { LocationRepository } from "../locations/location.repository.js";
import { MomentCommentRepository } from "../moments/moment-comment.repository.js";
import { MomentCommentService } from "../moments/moment-comment.service.js";
import { MomentReactionRepository } from "../moments/moment-reaction.repository.js";
import { MomentReactionService } from "../moments/moment-reaction.service.js";
import { MomentRelationshipRepository } from "../moments/moment-relationship.repository.js";
import { MomentRelationshipService } from "../moments/moment-relationship.service.js";
import { MomentRepository } from "../moments/moment.repository.js";
import { MomentService } from "../moments/moment.service.js";
import { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import { FollowRepository } from "../social/follow.repository.js";
import { FollowService } from "../social/follow.service.js";
import { UploadRepository } from "../uploads/upload.repository.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { ModerationRepository } from "./moderation.repository.js";
import { ModerationService } from "./moderation.service.js";

/**
 * Moderation, end to end against real infrastructure.
 *
 * Driven through HTTP, because what this feature claims is mostly about who
 * sees what, and a claim about visibility is only worth anything once it has
 * survived the real query. The rules that decide anything are pure and covered
 * exhaustively next door.
 *
 * The property under test throughout is the one `moderation.md:151` states:
 * moderation decides what Chronologity distributes, not what happened. Every
 * assertion about hiding is paired with one about the author still reading
 * their own, and every restriction is paired with a reversal restoring it.
 *
 * Requires `pnpm infra:up`.
 */

const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? "8025"}`;

const config = testAppConfig("moderation-integration");

const ADULT = "1990-04-12";

/** Fifteen today: old enough for an account, not old enough for everything. */
const teenBirthday = () => {
  const born = new Date();

  born.setUTCFullYear(born.getUTCFullYear() - 15);

  return born.toISOString().slice(0, 10);
};

const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

describe("moderation", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;
  let authorization: AuthorizationService;
  let moments: MomentService;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);
    authorization = new AuthorizationService(
      database.dataSource,
      new AuthorizationRepository(database.dataSource),
    );

    const moderationRepository = new ModerationRepository(database.dataSource);

    moments = new MomentService(
      database.dataSource,
      new MomentRepository(database.dataSource),
      new UploadRepository(database.dataSource),
      new LocationRepository(database.dataSource),
      new RealWorldEventRepository(database.dataSource),
      new FollowRepository(database.dataSource),
      new UserRepository(database.dataSource),
      moderationRepository,
      new MomentCommentRepository(database.dataSource),
    );

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, new UserRepository(database.dataSource), {
        minimumAgeYears: config.minimumAgeYears,
      }),
      authorization,
      follows: new FollowService(
        database.dataSource,
        new FollowRepository(database.dataSource),
        new UserRepository(database.dataSource),
        new RealWorldEventRepository(database.dataSource),
        new LocationRepository(database.dataSource),
        undefined,
        new MomentReactionRepository(database.dataSource),
        new MomentCommentRepository(database.dataSource),
      ),
      moments,
      momentRelationships: new MomentRelationshipService(
        database.dataSource,
        new MomentRelationshipRepository(database.dataSource),
        moments,
      ),
      momentReactions: new MomentReactionService(
        database.dataSource,
        new MomentReactionRepository(database.dataSource),
        new MomentRepository(database.dataSource),
        moments,
        new FollowRepository(database.dataSource),
      ),
      momentComments: new MomentCommentService(
        database.dataSource,
        new MomentCommentRepository(database.dataSource),
        new MomentRepository(database.dataSource),
        moments,
        new FollowRepository(database.dataSource),
        new UserRepository(database.dataSource),
      ),
      moderation: new ModerationService(database.dataSource, moderationRepository),
    });
  });

  afterAll(async () => {
    await app.close();
    await authentication.close();
    await database.close();
  });

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

  const authed = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  /** Sign in and finish creating an account. */
  const onboard = async (dateOfBirth = ADULT) => {
    const email = uniqueEmail();
    await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
    const token = await readLinkFor(email);
    const session = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token },
    });

    assert.equal(session.statusCode, 201, session.body);

    const accessToken = session.json().accessToken as string;
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(accessToken),
      payload: { handle: uniqueHandle(), displayName: "Test Person", dateOfBirth },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { accessToken, userId: created.json().userId as string };
  };

  /**
   * A moderator, made the only way a first one can be made: outside the
   * permission system, exactly as the CLI does it.
   */
  const onboardModerator = async () => {
    const account = await onboard();

    await authorization.assign(account.userId, "moderator", undefined, "integration test", {
      traceId: randomUUID(),
      actor: undefined,
      receivedAt: new Date(),
    });

    return account;
  };

  /** An administrator, who deliberately inherits nothing from the moderator role. */
  const onboardAdministrator = async () => {
    const account = await onboard();

    await authorization.assign(account.userId, "administrator", undefined, "integration test", {
      traceId: randomUUID(),
      actor: undefined,
      receivedAt: new Date(),
    });

    return account;
  };

  const summer = {
    start: "1998-06-01T00:00:00.000Z",
    end: "1998-08-31T23:59:59.000Z",
    precision: "month",
  } as const;

  /** Somebody with an account and a Moment they recorded. */
  const someoneWithAMoment = async (caption = "A thing that happened") => {
    const account = await onboard();
    const uploadId = await createReadyUpload(database.dataSource, account.userId);
    const recorded = await app.inject({
      method: "POST",
      url: "/moments",
      headers: authed(account.accessToken),
      payload: {
        caption,
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
      },
    });

    assert.equal(recorded.statusCode, 201, recorded.body);

    return { ...account, uploadId, momentId: recorded.json().momentId as string };
  };

  /** Put a subject into a state, as a moderator. */
  const moderate = async (
    moderatorToken: string,
    subjectType: string,
    subjectId: string,
    state: string,
    reason = "integration test",
  ) =>
    app.inject({
      method: "PUT",
      url: `/moderation/subjects/${subjectType}/${subjectId}/state`,
      headers: authed(moderatorToken),
      payload: { state, reason },
    });

  /** Read one Moment as somebody. */
  const readMoment = async (accessToken: string, momentId: string) =>
    app.inject({ method: "GET", url: `/moments/${momentId}`, headers: authed(accessToken) });

  /** Suspend an account, or let it back. */
  const suspendAccount = async (moderatorToken: string, userId: string, suspended: boolean) =>
    app.inject({
      method: "PUT",
      url: `/users/${userId}/suspension`,
      headers: authed(moderatorToken),
      payload: { suspended, reason: "integration test" },
    });

  describe("reporting", () => {
    it("lets anybody signed in report something", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();

      const response = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "harassment" },
      });

      assert.equal(response.statusCode, 201, response.body);
      assert.equal(response.json().status, "submitted");
    });

    it("changes no state, however many people report", async () => {
      const author = await someoneWithAMoment();

      for (let i = 0; i < 6; i += 1) {
        const reporter = await onboard();

        await app.inject({
          method: "POST",
          url: "/reports",
          headers: authed(reporter.accessToken),
          payload: { subjectType: "moment", subjectId: author.momentId, reason: "hate" },
        });
      }

      const stranger = await onboard();

      // Volume orders a queue and establishes nothing. A system where enough
      // reports hide something is a system where a group decides what history
      // survives.
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 200);
    });

    it("raises review priority as reports accumulate, and only that", async () => {
      const author = await someoneWithAMoment();
      const moderator = await onboardModerator();

      const first = await onboard();
      await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(first.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "threat" },
      });

      const second = await onboard();
      const reported = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(second.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "threat" },
      });

      const seen = await app.inject({
        method: "GET",
        url: `/moderation/reports/${reported.json().reportId}`,
        headers: authed(moderator.accessToken),
      });

      assert.equal(seen.json().priority, "urgent");
      assert.equal(seen.json().reportCount, 2);
      const stranger = await onboard();
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 200);
    });

    it("flags a burst without escalating it", async () => {
      const author = await someoneWithAMoment();
      const moderator = await onboardModerator();
      let reportId = "";

      for (let i = 0; i < 5; i += 1) {
        const reporter = await onboard();
        const filed = await app.inject({
          method: "POST",
          url: "/reports",
          headers: authed(reporter.accessToken),
          payload: { subjectType: "moment", subjectId: author.momentId, reason: "spam" },
        });

        reportId = filed.json().reportId;
      }

      const seen = await app.inject({
        method: "GET",
        url: `/moderation/reports/${reportId}`,
        headers: authed(moderator.accessToken),
      });

      assert.equal(seen.json().burst, true);
      // A burst may mean many people saw something awful at once, or that a
      // group agreed to report somebody. The flag says which question to ask.
      assert.equal(seen.json().status, "submitted");
      const stranger = await onboard();
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 200);
    });

    it("counts one person once, however many times they report", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();
      const moderator = await onboardModerator();

      const first = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "spam" },
      });
      const again = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "spam" },
      });

      // The second returns the first rather than failing: what they wanted —
      // that Chronologity knows — is already true.
      assert.equal(again.statusCode, 201, again.body);
      assert.equal(again.json().reportId, first.json().reportId);

      const seen = await app.inject({
        method: "GET",
        url: `/moderation/reports/${first.json().reportId}`,
        headers: authed(moderator.accessToken),
      });

      assert.equal(seen.json().reportCount, 1);
    });

    it("never tells the subject who reported them", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();
      const moderator = await onboardModerator();

      const filed = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "harassment" },
      });

      await moderate(moderator.accessToken, "moment", author.momentId, "warned");

      const history = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(author.accessToken),
      });

      assert.equal(history.statusCode, 200, history.body);
      assert.ok(!history.body.includes(reporter.userId));
      // And the reporter is not reachable through the report either.
      const asAuthor = await app.inject({
        method: "GET",
        url: `/reports/${filed.json().reportId}`,
        headers: authed(author.accessToken),
      });

      assert.equal(asAuthor.statusCode, 404, asAuthor.body);
    });

    it("refuses a report about something that does not exist", async () => {
      const reporter = await onboard();

      const response = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: randomUUID(), reason: "spam" },
      });

      assert.equal(response.statusCode, 404, response.body);
    });
  });

  describe("what a reporter may see", () => {
    it("lets a reporter follow the status of what they filed", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();
      const moderator = await onboardModerator();

      const filed = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "spam" },
      });

      await app.inject({
        method: "PUT",
        url: `/moderation/reports/${filed.json().reportId}`,
        headers: authed(moderator.accessToken),
        payload: { status: "resolved" },
      });

      const seen = await app.inject({
        method: "GET",
        url: `/reports/${filed.json().reportId}`,
        headers: authed(reporter.accessToken),
      });

      assert.equal(seen.statusCode, 200, seen.body);
      assert.equal(seen.json().status, "resolved");
      assert.ok(seen.json().resolvedAt !== null);
    });

    it("gives a reporter no reviewer identity and nothing internal", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();
      const moderator = await onboardModerator();

      const filed = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "threat" },
      });

      await app.inject({
        method: "PUT",
        url: `/moderation/reports/${filed.json().reportId}`,
        headers: authed(moderator.accessToken),
        payload: { status: "under_review" },
      });

      const seen = await app.inject({
        method: "GET",
        url: `/reports/${filed.json().reportId}`,
        headers: authed(reporter.accessToken),
      });

      const body = seen.json();

      assert.equal(body.priority, undefined);
      assert.equal(body.burst, undefined);
      assert.equal(body.reporterUserId, undefined);
      assert.ok(!seen.body.includes(moderator.userId));
      assert.ok(!seen.body.includes(author.userId));
    });

    it("refuses a reporter somebody else's report", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();
      const nosy = await onboard();

      const filed = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "spam" },
      });

      const seen = await app.inject({
        method: "GET",
        url: `/reports/${filed.json().reportId}`,
        headers: authed(nosy.accessToken),
      });

      // Absent rather than forbidden: that a report exists about a given
      // subject is itself something they are not entitled to learn.
      assert.equal(seen.statusCode, 404, seen.body);
    });

    it("lists only your own reports", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();
      const other = await onboard();

      await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(other.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "hate" },
      });
      await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "spam" },
      });

      const mine = await app.inject({
        method: "GET",
        url: "/reports",
        headers: authed(reporter.accessToken),
      });

      assert.equal(mine.json().reports.length, 1);
      assert.equal(mine.json().reports[0].reason, "spam");
    });
  });

  describe("who may moderate", () => {
    it("refuses an ordinary User every moderator surface", async () => {
      const ordinary = await onboard();
      const author = await someoneWithAMoment();

      const surfaces = [
        { method: "GET" as const, url: "/moderation/reports" },
        { method: "GET" as const, url: "/moderation/accuracy-reports" },
        { method: "GET" as const, url: "/moderation/appeals" },
      ];

      for (const surface of surfaces) {
        const response = await app.inject({ ...surface, headers: authed(ordinary.accessToken) });

        assert.equal(response.statusCode, 403, `${surface.url}: ${response.body}`);
      }

      const moderated = await moderate(ordinary.accessToken, "moment", author.momentId, "removed");

      assert.equal(moderated.statusCode, 403, moderated.body);
    });

    it("refuses an administrator, who inherits nothing from the moderator role", async () => {
      const administrator = await onboardAdministrator();
      const author = await someoneWithAMoment();

      const queue = await app.inject({
        method: "GET",
        url: "/moderation/reports",
        headers: authed(administrator.accessToken),
      });

      assert.equal(queue.statusCode, 403, queue.body);

      const moderated = await moderate(
        administrator.accessToken,
        "moment",
        author.momentId,
        "removed",
      );

      // There is no hierarchy. Somebody who needs both roles gets both,
      // explicitly and auditably.
      assert.equal(moderated.statusCode, 403, moderated.body);
    });

    it("records an attempt by somebody without the permission", async () => {
      const author = await someoneWithAMoment();
      const prober = await onboard();

      await moderate(prober.accessToken, "moment", author.momentId, "removed");

      const rows: { count: number }[] = await database.dataSource.query(
        `SELECT COUNT(*)::int AS count FROM moderation_actions
          WHERE subject_id = $1 AND actor_user_id = $2 AND outcome = 'failure'`,
        [author.momentId, prober.userId],
      );

      assert.equal(rows[0]?.count, 1);
    });

    it("does not report a refused attempt to the person it was aimed at", async () => {
      const author = await someoneWithAMoment();
      const prober = await onboard();

      await moderate(prober.accessToken, "moment", author.momentId, "removed");

      const history = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(author.accessToken),
      });

      // Evidence for a security review, not something that happened to them.
      // Announcing it would tell them something occurred when nothing did.
      assert.deepEqual(history.json().records, []);
    });
  });

  describe("what a moderation state does", () => {
    it("hides a removed Moment from everybody but its author", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "removed");

      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 404);
      // The author still reads it, which is what makes an appeal possible.
      assert.equal((await readMoment(author.accessToken, author.momentId)).statusCode, 200);
    });

    it("hides a Moment withheld during review, and gives it back afterwards", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "temporarily_unavailable");
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 404);

      await moderate(moderator.accessToken, "moment", author.momentId, "allowed");
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 200);
    });

    it("keeps a narrowed Moment narrow even after its author makes it public", async () => {
      const author = await someoneWithAMoment();
      const friend = await onboard();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await app.inject({
        method: "PUT",
        url: `/moments/${author.momentId}/visibility`,
        headers: authed(author.accessToken),
        payload: { visibility: "restricted", audience: [friend.userId] },
      });

      await moderate(
        moderator.accessToken,
        "moment",
        author.momentId,
        "restricted_to_authorized_audience",
      );

      assert.equal((await readMoment(friend.accessToken, author.momentId)).statusCode, 200);
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 404);

      const widened = await app.inject({
        method: "PUT",
        url: `/moments/${author.momentId}/visibility`,
        headers: authed(author.accessToken),
        payload: { visibility: "public" },
      });

      assert.equal(widened.statusCode, 200, widened.body);

      // This is the whole of what the state does that `removed` and `private`
      // do not: the author may still edit their own Moment, and cannot widen
      // it past what Chronologity decided. Making it public here empties the
      // audience, so the Moment narrows to its author alone rather than
      // reaching everybody.
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 404);
      assert.equal((await readMoment(author.accessToken, author.momentId)).statusCode, 200);
    });

    it("hides an age-restricted Moment from somebody under eighteen", async () => {
      const author = await someoneWithAMoment();
      const teenager = await onboard(teenBirthday());
      const adult = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "age_restricted");

      assert.equal((await readMoment(teenager.accessToken, author.momentId)).statusCode, 404);
      assert.equal((await readMoment(adult.accessToken, author.momentId)).statusCode, 200);
    });

    it("hides nothing when a Moment only carries a warning", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "warned");

      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 200);
    });

    it("hides nothing when a Moment is only kept out of amplification", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await moderate(
        moderator.accessToken,
        "moment",
        author.momentId,
        "restricted_from_amplification",
      );

      // Allowed to exist and to be reached directly. What it is kept out of is
      // Discovery and broad Search, which 5O and 5P enforce.
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 200);
    });

    it("never alters occurrence, authorship, or position in chronology", async () => {
      const author = await someoneWithAMoment();
      const moderator = await onboardModerator();

      const before = (await readMoment(author.accessToken, author.momentId)).json();

      await moderate(moderator.accessToken, "moment", author.momentId, "removed");

      const after = (await readMoment(author.accessToken, author.momentId)).json();

      // The whole distinction, asserted directly: moderation decides what
      // Chronologity distributes, not what happened.
      assert.deepEqual(after.occurrence, before.occurrence);
      assert.equal(after.occurrenceOffsetMinutes, before.occurrenceOffsetMinutes);
      assert.equal(after.authorUserId, before.authorUserId);
      assert.equal(after.caption, before.caption);
    });

    it("settles the open reports about a subject when it is acted on", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();
      const moderator = await onboardModerator();

      const filed = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "hate" },
      });

      await moderate(moderator.accessToken, "moment", author.momentId, "removed");

      const seen = await app.inject({
        method: "GET",
        url: `/reports/${filed.json().reportId}`,
        headers: authed(reporter.accessToken),
      });

      // Otherwise the queue fills with work already done and every reporter's
      // view sits at "submitted" indefinitely.
      assert.equal(seen.json().status, "resolved");
    });

    it("lets a report be closed with nothing done", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();
      const moderator = await onboardModerator();
      const stranger = await onboard();

      const filed = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "spam" },
      });

      const closed = await app.inject({
        method: "PUT",
        url: `/moderation/reports/${filed.json().reportId}`,
        headers: authed(moderator.accessToken),
        payload: { status: "closed" },
      });

      assert.equal(closed.statusCode, 200, closed.body);
      // No violation is a real outcome. The alternative is a system where being
      // reported is itself a penalty.
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 200);
    });

    it("refuses to reopen a resolved report", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();
      const moderator = await onboardModerator();

      const filed = await app.inject({
        method: "POST",
        url: "/reports",
        headers: authed(reporter.accessToken),
        payload: { subjectType: "moment", subjectId: author.momentId, reason: "spam" },
      });

      await app.inject({
        method: "PUT",
        url: `/moderation/reports/${filed.json().reportId}`,
        headers: authed(moderator.accessToken),
        payload: { status: "resolved" },
      });

      const reopened = await app.inject({
        method: "PUT",
        url: `/moderation/reports/${filed.json().reportId}`,
        headers: authed(moderator.accessToken),
        payload: { status: "under_review" },
      });

      assert.equal(reopened.statusCode, 400, reopened.body);
    });
  });

  describe("suspension", () => {
    const suspend = suspendAccount;

    it("hides a suspended account's Moments from everybody else", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await suspend(moderator.accessToken, author.userId, true);

      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 404);
    });

    it("leaves the suspended person reading their own history", async () => {
      const author = await someoneWithAMoment();
      const moderator = await onboardModerator();

      await suspend(moderator.accessToken, author.userId, true);

      // Restricted, not erased. Somebody who cannot see what was hidden cannot
      // meaningfully appeal it.
      assert.equal((await readMoment(author.accessToken, author.momentId)).statusCode, 200);
    });

    it("stops a suspended account writing anything", async () => {
      const author = await someoneWithAMoment();
      const other = await someoneWithAMoment();
      const moderator = await onboardModerator();

      await suspend(moderator.accessToken, author.userId, true);

      const uploadId = await createReadyUpload(database.dataSource, author.userId);
      const attempts = [
        app.inject({
          method: "POST",
          url: "/moments",
          headers: authed(author.accessToken),
          payload: {
            caption: "Another",
            occurrence: summer,
            occurrenceOffsetMinutes: 0,
            uploadIds: [uploadId],
          },
        }),
        app.inject({
          method: "POST",
          url: `/moments/${other.momentId}/comments`,
          headers: authed(author.accessToken),
          payload: { body: "Something" },
        }),
        app.inject({
          method: "PUT",
          url: `/moments/${other.momentId}/reaction`,
          headers: authed(author.accessToken),
          payload: { kind: "loved" },
        }),
        app.inject({
          method: "POST",
          url: `/users/${other.userId}/follow`,
          headers: authed(author.accessToken),
        }),
      ];

      for (const attempt of await Promise.all(attempts)) {
        assert.equal(attempt.statusCode, 403, attempt.body);
      }
    });

    it("lets a suspended account still read and appeal", async () => {
      const author = await someoneWithAMoment();
      const moderator = await onboardModerator();

      await suspend(moderator.accessToken, author.userId, true);

      const history = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(author.accessToken),
      });

      assert.equal(history.statusCode, 200, history.body);
      assert.equal(history.json().records.length, 1);

      const appealed = await app.inject({
        method: "POST",
        url: "/appeals",
        headers: authed(author.accessToken),
        payload: {
          actionId: history.json().records[0].actionId,
          statement: "I would like this looked at again",
        },
      });

      // An enforcement system somebody cannot answer is not one.
      assert.equal(appealed.statusCode, 201, appealed.body);
    });

    it("leaves follows, blocks, and relationships intact", async () => {
      const author = await someoneWithAMoment();
      const follower = await onboard();
      const moderator = await onboardModerator();

      await app.inject({
        method: "POST",
        url: `/users/${author.userId}/follow`,
        headers: authed(follower.accessToken),
      });

      await suspend(moderator.accessToken, author.userId, true);

      const rows: { count: number }[] = await database.dataSource.query(
        "SELECT COUNT(*)::int AS count FROM user_follows WHERE followed_user_id = $1",
        [author.userId],
      );

      // Nothing is deleted, because the account may come back and the history
      // it was part of has to be there when it does (`social-graph.md:486`).
      assert.equal(rows[0]?.count, 1);
    });

    it("restores everything on reinstatement", async () => {
      const author = await someoneWithAMoment("Exactly this caption");
      const stranger = await onboard();
      const moderator = await onboardModerator();

      const before = (await readMoment(stranger.accessToken, author.momentId)).json();

      await suspend(moderator.accessToken, author.userId, true);
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 404);

      await suspend(moderator.accessToken, author.userId, false);
      const after = (await readMoment(stranger.accessToken, author.momentId)).json();

      // Where "nothing was deleted" stops being a claim and becomes a test.
      assert.deepEqual(after, before);
    });

    it("stops a suspended account's reactions counting, and brings them back", async () => {
      const author = await someoneWithAMoment();
      const reactor = await onboard();
      const moderator = await onboardModerator();

      await app.inject({
        method: "PUT",
        url: `/moments/${author.momentId}/reaction`,
        headers: authed(reactor.accessToken),
        payload: { kind: "loved" },
      });

      const reactions = async () =>
        app.inject({
          method: "GET",
          url: `/moments/${author.momentId}/reactions`,
          headers: authed(author.accessToken),
        });

      assert.equal((await reactions()).json().total, 1);

      await suspend(moderator.accessToken, reactor.userId, true);

      // Otherwise a suspended account goes on amplifying content it can no
      // longer see, and significance scoring reads these numbers.
      assert.equal((await reactions()).json().total, 0);

      await suspend(moderator.accessToken, reactor.userId, false);

      // Nothing was deleted: the rows stayed, and the totals come back exactly.
      assert.equal((await reactions()).json().total, 1);
    });

    it("keeps the comment count equal to the comments a Viewer can read", async () => {
      const author = await someoneWithAMoment();
      const talker = await onboard();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await app.inject({
        method: "POST",
        url: `/moments/${author.momentId}/comments`,
        headers: authed(talker.accessToken),
        payload: { body: "Something said out loud" },
      });

      await suspend(moderator.accessToken, talker.userId, true);

      const seen = await app.inject({
        method: "GET",
        url: `/moments/${author.momentId}/comments`,
        headers: authed(stranger.accessToken),
      });

      // A count that exceeds the readable comments is a visible lie about how
      // many people spoke.
      assert.equal(seen.json().comments.length, 0);
      assert.equal(seen.json().total, 0);
    });

    it("is idempotent, and records no second decision", async () => {
      const author = await someoneWithAMoment();
      const moderator = await onboardModerator();

      await suspend(moderator.accessToken, author.userId, true);
      const again = await suspend(moderator.accessToken, author.userId, true);

      assert.equal(again.statusCode, 200, again.body);

      const rows: { count: number }[] = await database.dataSource.query(
        `SELECT COUNT(*)::int AS count FROM moderation_actions
          WHERE affected_user_id = $1 AND subject_type = 'user' AND outcome = 'success'`,
        [author.userId],
      );

      // Writing an action for a decision nobody made would put noise into the
      // record somebody reads when they ask what happened to them.
      assert.equal(rows[0]?.count, 1);
    });
  });

  describe("appeals", () => {
    it("restores what was restricted when an appeal is reversed", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "removed");
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 404);

      const history = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(author.accessToken),
      });
      const appealed = await app.inject({
        method: "POST",
        url: "/appeals",
        headers: authed(author.accessToken),
        payload: {
          actionId: history.json().records[0].actionId,
          statement: "This is documentary evidence, not the thing itself",
        },
      });

      const decided = await app.inject({
        method: "PUT",
        url: `/moderation/appeals/${appealed.json().appealId}`,
        headers: authed(moderator.accessToken),
        payload: { outcome: "reversed", resolution: "On reflection, allowed" },
      });

      assert.equal(decided.statusCode, 200, decided.body);
      // Possible only because moderation hid it rather than destroying it.
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 200);
    });

    it("changes nothing when an appeal is upheld", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "removed");

      const history = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(author.accessToken),
      });
      const appealed = await app.inject({
        method: "POST",
        url: "/appeals",
        headers: authed(author.accessToken),
        payload: { actionId: history.json().records[0].actionId, statement: "Please reconsider" },
      });

      await app.inject({
        method: "PUT",
        url: `/moderation/appeals/${appealed.json().appealId}`,
        headers: authed(moderator.accessToken),
        payload: { outcome: "upheld", resolution: "The decision stands" },
      });

      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 404);
    });

    it("refuses a second appeal while one is open", async () => {
      const author = await someoneWithAMoment();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "removed");

      const history = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(author.accessToken),
      });
      const actionId = history.json().records[0].actionId;

      await app.inject({
        method: "POST",
        url: "/appeals",
        headers: authed(author.accessToken),
        payload: { actionId, statement: "First" },
      });
      const second = await app.inject({
        method: "POST",
        url: "/appeals",
        headers: authed(author.accessToken),
        payload: { actionId, statement: "Second" },
      });

      // Refused rather than swallowed, because an appeal carries a statement
      // somebody wrote.
      assert.equal(second.statusCode, 400, second.body);
    });

    it("refuses an appeal against somebody else's action", async () => {
      const author = await someoneWithAMoment();
      const opportunist = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "removed");

      const history = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(author.accessToken),
      });

      const appealed = await app.inject({
        method: "POST",
        url: "/appeals",
        headers: authed(opportunist.accessToken),
        payload: { actionId: history.json().records[0].actionId, statement: "Not mine" },
      });

      assert.equal(appealed.statusCode, 404, appealed.body);
    });

    it("shows an appellant their own outcome and nobody else's", async () => {
      const author = await someoneWithAMoment();
      const nosy = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "warned");

      const history = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(author.accessToken),
      });
      const appealed = await app.inject({
        method: "POST",
        url: "/appeals",
        headers: authed(author.accessToken),
        payload: { actionId: history.json().records[0].actionId, statement: "Please reconsider" },
      });

      await app.inject({
        method: "PUT",
        url: `/moderation/appeals/${appealed.json().appealId}`,
        headers: authed(moderator.accessToken),
        payload: { outcome: "upheld", resolution: "The warning stands" },
      });

      const mine = await app.inject({
        method: "GET",
        url: `/appeals/${appealed.json().appealId}`,
        headers: authed(author.accessToken),
      });
      const theirs = await app.inject({
        method: "GET",
        url: `/appeals/${appealed.json().appealId}`,
        headers: authed(nosy.accessToken),
      });

      assert.equal(mine.json().outcome, "upheld");
      assert.equal(mine.json().resolution, "The warning stands");
      assert.equal(theirs.statusCode, 404, theirs.body);
    });
  });

  describe("transparency", () => {
    it("tells somebody what was done to their content, and why", async () => {
      const author = await someoneWithAMoment();
      const moderator = await onboardModerator();

      await moderate(
        moderator.accessToken,
        "moment",
        author.momentId,
        "warned",
        "Distressing imagery",
      );

      const history = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(author.accessToken),
      });

      const record = history.json().records[0];

      assert.equal(record.state, "warned");
      assert.equal(record.reason, "Distressing imagery");
      assert.equal(record.subjectId, author.momentId);
      assert.equal(record.appealStatus, "none");
    });

    it("tells nobody what was done to anybody else's", async () => {
      const author = await someoneWithAMoment();
      const nosy = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "removed");

      const history = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(nosy.accessToken),
      });

      assert.deepEqual(history.json().records, []);
    });

    it("shows whether a decision has been appealed and how it went", async () => {
      const author = await someoneWithAMoment();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "removed");

      const before = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(author.accessToken),
      });
      const actionId = before.json().records[0].actionId;

      const appealed = await app.inject({
        method: "POST",
        url: "/appeals",
        headers: authed(author.accessToken),
        payload: { actionId, statement: "Please reconsider" },
      });

      const during = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(author.accessToken),
      });

      assert.equal(
        during.json().records.find((r: { actionId: string }) => r.actionId === actionId)
          .appealStatus,
        "open",
      );

      await app.inject({
        method: "PUT",
        url: `/moderation/appeals/${appealed.json().appealId}`,
        headers: authed(moderator.accessToken),
        payload: { outcome: "reversed", resolution: "Allowed after all" },
      });

      const after = await app.inject({
        method: "GET",
        url: "/me/moderation-history",
        headers: authed(author.accessToken),
      });

      assert.equal(
        after.json().records.find((r: { actionId: string }) => r.actionId === actionId)
          .appealStatus,
        "reversed",
      );
    });
  });

  describe("historical accuracy", () => {
    it("keeps accuracy reports out of the safety queue", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();
      const moderator = await onboardModerator();

      const filed = await app.inject({
        method: "POST",
        url: "/accuracy-reports",
        headers: authed(reporter.accessToken),
        payload: {
          momentId: author.momentId,
          reason: "wrong_date",
          detail: "This happened in 2004, not 2005",
        },
      });

      assert.equal(filed.statusCode, 201, filed.body);

      const safety = await app.inject({
        method: "GET",
        url: "/moderation/reports?limit=100",
        headers: authed(moderator.accessToken),
      });
      const accuracy = await app.inject({
        method: "GET",
        url: "/moderation/accuracy-reports?limit=100",
        headers: authed(moderator.accessToken),
      });

      const inSafety = safety
        .json()
        .reports.some((r: { subjectId: string }) => r.subjectId === author.momentId);
      const inAccuracy = accuracy
        .json()
        .reports.some((r: { momentId: string }) => r.momentId === author.momentId);

      assert.equal(inSafety, false);
      assert.equal(inAccuracy, true);
    });

    it("resolves an accuracy report without touching any moderation state", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      const filed = await app.inject({
        method: "POST",
        url: "/accuracy-reports",
        headers: authed(reporter.accessToken),
        payload: { momentId: author.momentId, reason: "wrong_place", detail: "That is Leeds" },
      });

      const resolved = await app.inject({
        method: "PUT",
        url: `/moderation/accuracy-reports/${filed.json().reportId}`,
        headers: authed(moderator.accessToken),
        payload: { status: "resolved" },
      });

      assert.equal(resolved.statusCode, 200, resolved.body);
      assert.equal(resolved.json().status, "resolved");

      // A wrong date is something to fix, not something to enforce against.
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 200);

      const rows: { count: number }[] = await database.dataSource.query(
        "SELECT COUNT(*)::int AS count FROM moderation_states WHERE subject_id = $1",
        [author.momentId],
      );

      assert.equal(rows[0]?.count, 0);
    });

    it("lets a reporter read their own accuracy report and not somebody else's", async () => {
      const author = await someoneWithAMoment();
      const reporter = await onboard();
      const nosy = await onboard();

      const filed = await app.inject({
        method: "POST",
        url: "/accuracy-reports",
        headers: authed(reporter.accessToken),
        payload: { momentId: author.momentId, reason: "wrong_event", detail: "Different wedding" },
      });

      const mine = await app.inject({
        method: "GET",
        url: `/accuracy-reports/${filed.json().reportId}`,
        headers: authed(reporter.accessToken),
      });
      const theirs = await app.inject({
        method: "GET",
        url: `/accuracy-reports/${filed.json().reportId}`,
        headers: authed(nosy.accessToken),
      });

      assert.equal(mine.statusCode, 200, mine.body);
      assert.equal(theirs.statusCode, 404, theirs.body);
    });
  });

  describe("the set query, which is a second statement of the same rule", () => {
    /**
     * Reading one Moment and listing somebody's Moments take different paths:
     * one applies the rule in TypeScript, the other in SQL, because a set query
     * cannot call a per-row function without breaking keyset pagination. Both
     * statements therefore need proving separately — deliberately breaking the
     * SQL half left every single-Moment test above passing, which is what these
     * exist to stop.
     */
    const listBy = async (accessToken: string, authorUserId: string) =>
      app.inject({
        method: "GET",
        url: `/users/${authorUserId}/moments`,
        headers: authed(accessToken),
      });

    it("omits a removed Moment from a listing, and keeps it in the author's own", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "removed");

      const theirs = await listBy(stranger.accessToken, author.userId);
      const own = await listBy(author.accessToken, author.userId);

      assert.equal(theirs.statusCode, 200, theirs.body);
      assert.equal(
        theirs.json().moments.some((m: { momentId: string }) => m.momentId === author.momentId),
        false,
      );
      assert.equal(
        own.json().moments.some((m: { momentId: string }) => m.momentId === author.momentId),
        true,
      );
    });

    it("omits a Moment withheld during review from a listing", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "temporarily_unavailable");

      const theirs = await listBy(stranger.accessToken, author.userId);

      assert.equal(
        theirs.json().moments.some((m: { momentId: string }) => m.momentId === author.momentId),
        false,
      );
    });

    it("omits a suspended account's Moments from a listing", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await suspendAccount(moderator.accessToken, author.userId, true);

      const theirs = await listBy(stranger.accessToken, author.userId);

      assert.deepEqual(theirs.json().moments, []);
      // And the suspended person still reads their own.
      const own = await listBy(author.accessToken, author.userId);

      assert.equal(own.json().moments.length, 1);
    });

    it("omits an age-restricted Moment from a listing for somebody under eighteen", async () => {
      const author = await someoneWithAMoment();
      const teenager = await onboard(teenBirthday());
      const adult = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "age_restricted");

      const young = await listBy(teenager.accessToken, author.userId);
      const older = await listBy(adult.accessToken, author.userId);

      assert.deepEqual(young.json().moments, []);
      assert.equal(older.json().moments.length, 1);
    });

    it("narrows a listing to the audience when moderation says so", async () => {
      const author = await someoneWithAMoment();
      const friend = await onboard();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await app.inject({
        method: "PUT",
        url: `/moments/${author.momentId}/visibility`,
        headers: authed(author.accessToken),
        payload: { visibility: "restricted", audience: [friend.userId] },
      });

      await moderate(
        moderator.accessToken,
        "moment",
        author.momentId,
        "restricted_to_authorized_audience",
      );

      assert.equal((await listBy(friend.accessToken, author.userId)).json().moments.length, 1);
      assert.deepEqual((await listBy(stranger.accessToken, author.userId)).json().moments, []);
    });

    it("keeps a warned Moment in a listing", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await moderate(moderator.accessToken, "moment", author.momentId, "warned");

      assert.equal((await listBy(stranger.accessToken, author.userId)).json().moments.length, 1);
    });

    it("keeps a Moment kept out of amplification in a listing", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      await moderate(
        moderator.accessToken,
        "moment",
        author.momentId,
        "restricted_from_amplification",
      );

      assert.equal((await listBy(stranger.accessToken, author.userId)).json().moments.length, 1);
    });
  });

  describe("chains and media", () => {
    it("leaves a tombstone where moderation took the far end of a chain", async () => {
      const author = await someoneWithAMoment("The first thing");
      const moderator = await onboardModerator();
      const stranger = await onboard();

      const uploadId = await createReadyUpload(database.dataSource, author.userId);
      const second = await app.inject({
        method: "POST",
        url: "/moments",
        headers: authed(author.accessToken),
        payload: {
          caption: "What it led to",
          occurrence: {
            start: "1999-06-01T00:00:00.000Z",
            end: "1999-06-01T00:00:00.000Z",
            precision: "instant",
          },
          occurrenceOffsetMinutes: 0,
          uploadIds: [uploadId],
        },
      });

      const secondId = second.json().momentId as string;

      const related = await app.inject({
        method: "POST",
        url: `/moments/${author.momentId}/relationships`,
        headers: authed(author.accessToken),
        payload: { targetMomentId: secondId, kind: "led_to" },
      });

      assert.equal(related.statusCode, 201, related.body);

      await moderate(moderator.accessToken, "moment", secondId, "removed");

      const seen = await app.inject({
        method: "GET",
        url: `/moments/${author.momentId}/relationships`,
        headers: authed(stranger.accessToken),
      });

      assert.equal(seen.statusCode, 200, seen.body);
      assert.equal(seen.json().relationships.length, 1);

      const tombstone = seen.json().relationships[0];

      // The chain keeps its shape rather than silently becoming two unrelated
      // pairs (`moderation.md:713`), and carries nothing about what is missing.
      assert.equal(tombstone.unavailable, true);
      assert.ok(!seen.body.includes("What it led to"));
    });

    it("omits a relationship entirely where privacy hides the far end", async () => {
      const author = await someoneWithAMoment("The first thing");
      const stranger = await onboard();

      const uploadId = await createReadyUpload(database.dataSource, author.userId);
      const second = await app.inject({
        method: "POST",
        url: "/moments",
        headers: authed(author.accessToken),
        payload: {
          caption: "Something private",
          occurrence: {
            start: "1999-06-01T00:00:00.000Z",
            end: "1999-06-01T00:00:00.000Z",
            precision: "instant",
          },
          occurrenceOffsetMinutes: 0,
          uploadIds: [uploadId],
        },
      });

      const secondId = second.json().momentId as string;

      await app.inject({
        method: "POST",
        url: `/moments/${author.momentId}/relationships`,
        headers: authed(author.accessToken),
        payload: { targetMomentId: secondId, kind: "led_to" },
      });

      await app.inject({
        method: "PUT",
        url: `/moments/${secondId}/visibility`,
        headers: authed(author.accessToken),
        payload: { visibility: "private" },
      });

      const seen = await app.inject({
        method: "GET",
        url: `/moments/${author.momentId}/relationships`,
        headers: authed(stranger.accessToken),
      });

      // No tombstone here. `privacy.md:158` forbids using a visible
      // relationship to reveal an inaccessible Moment, and a marker where
      // somebody's private history sits would announce that it exists.
      assert.deepEqual(seen.json().relationships, []);
    });

    it("makes a Moment unavailable when moderation takes its last medium", async () => {
      const author = await someoneWithAMoment();
      const stranger = await onboard();
      const moderator = await onboardModerator();

      const moderated = await moderate(moderator.accessToken, "media", author.uploadId, "removed");

      assert.equal(moderated.statusCode, 200, moderated.body);

      // A Moment without media could not have been created, so one whose last
      // medium has gone cannot stay readable. The rule falls out of 5H's
      // existing refusal rather than being invented here.
      assert.equal((await readMoment(stranger.accessToken, author.momentId)).statusCode, 404);
      assert.equal((await readMoment(author.accessToken, author.momentId)).statusCode, 200);
    });

    it("leaves a Moment readable when it has other media", async () => {
      const author = await onboard();
      const first = await createReadyUpload(database.dataSource, author.userId);
      const second = await createReadyUpload(database.dataSource, author.userId);
      const stranger = await onboard();
      const moderator = await onboardModerator();

      const recorded = await app.inject({
        method: "POST",
        url: "/moments",
        headers: authed(author.accessToken),
        payload: {
          caption: "Two photographs",
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [first, second],
        },
      });

      assert.equal(recorded.statusCode, 201, recorded.body);

      await moderate(moderator.accessToken, "media", first, "removed");

      const seen = await readMoment(stranger.accessToken, recorded.json().momentId);

      assert.equal(seen.statusCode, 200, seen.body);
    });
  });
});
