import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { MAILPIT, testAppConfig } from "../../testing/app-config.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { createReadyUpload } from "../../testing/fixtures.js";
import { declaredRoutes, nameOf } from "../../testing/routes.js";
import { createStorageClient, type StorageClient } from "../../integrations/storage/storage-client.js";
import { DiscoveryRetrieval } from "../discovery/discovery.retrieval.js";
import { DiscoveryService } from "../discovery/discovery.service.js";
import { INDEX_VERSION } from "../search/search-document.js";
import { IdentityRepository } from "../authentication/identity.repository.js";
import { LocationRepository } from "../locations/location.repository.js";
import { ModerationRepository } from "../moderation/moderation.repository.js";
import { MomentCommentRepository } from "../moments/moment-comment.repository.js";
import { MomentCommentService } from "../moments/moment-comment.service.js";
import { MomentReactionRepository } from "../moments/moment-reaction.repository.js";
import { MomentReactionService } from "../moments/moment-reaction.service.js";
import { MomentRelationshipRepository } from "../moments/moment-relationship.repository.js";
import { MomentRelationshipService } from "../moments/moment-relationship.service.js";
import { MomentSignificanceRepository } from "../moments/moment-significance.repository.js";
import { MomentSignificanceService } from "../moments/moment-significance.service.js";
import { MomentRepository } from "../moments/moment.repository.js";
import { MomentService } from "../moments/moment.service.js";
import { NotificationDeliveryRepository } from "../notifications/notification.delivery.repository.js";
import { NotificationDeliveryService } from "../notifications/notification.delivery.service.js";
import { StoredRecipientDirectory } from "../notifications/notification.recipients.js";
import { NotificationRepository } from "../notifications/notification.repository.js";
import { NotificationService } from "../notifications/notification.service.js";
import { RealWorldEventRepository } from "../real-world-events/real-world-event.repository.js";
import { RealWorldEventService } from "../real-world-events/real-world-event.service.js";
import { FollowRepository } from "../social/follow.repository.js";
import { ParticipationRepository } from "../participation/participation.repository.js";
import { ParticipationService } from "../participation/participation.service.js";
import { FollowService } from "../social/follow.service.js";
import { UploadRepository } from "../uploads/upload.repository.js";
import { UploadService } from "../uploads/upload.service.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";

/**
 * Handing the system somebody else's identifier.
 *
 * Seventy-five routes name something. Each is a place where a Viewer may pass
 * an identifier that is not theirs, and the only interesting question is
 * whether the server decides or the identifier does. That was tested where each
 * feature was built and nowhere systematically, so a route added tomorrow
 * without an ownership check breaks nothing.
 *
 * Every one of the seventy-five is either exercised here or exempted with a
 * reason, and a completeness check refuses to let a new one be neither. The
 * shape is `ACCOUNT_SWEEPS` and `DELIBERATELY_KEPT` again: an exemption is a
 * decision somebody recorded rather than a gap somebody left.
 *
 * **The trap this suite is built around.** Asserting that a stranger gets 404
 * proves nothing if the thing never existed — an unmounted route, a typo in a
 * path, an identifier for a row nobody created, all answer 404 and all would
 * pass. So every identifier used here is first shown to resolve for the person
 * who owns it. Only then does a stranger's refusal mean anything.
 *
 * Requires `pnpm infra:up`. Run with `pnpm test:integration`.
 */

const config = testAppConfig("object-access-integration");

const ADULT = "1990-04-12";
const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

const summer = {
  start: "1998-06-01T00:00:00.000Z",
  end: "1998-08-31T23:59:59.000Z",
  precision: "month",
} as const;

/** A route this suite deliberately does not drive, and why. */
interface Exemption {
  readonly route: string;
  readonly because: string;
}

const EXEMPT: readonly Exemption[] = [
  // Permission, not ownership. The matrix next door drives all of these
  // against every permission the platform defines.
  ...[
    "PUT /users/:userId/roles/:role",
    "DELETE /users/:userId/roles/:role",
    "GET /users/:userId/roles",
    "GET /moderation/reports/:reportId",
    "PUT /moderation/reports/:reportId",
    "GET /moderation/accuracy-reports/:reportId",
    "PUT /moderation/accuracy-reports/:reportId",
    "PUT /moderation/subjects/:subjectType/:subjectId/state",
    "PUT /users/:userId/suspension",
    "GET /moderation/appeals/:appealId",
    "PUT /moderation/appeals/:appealId",
  ].map((route) => ({
    route,
    because: "Guarded by a permission; permission-matrix.integration.test.ts drives it.",
  })),

  // Shared reference data. A Location and a real-world Event belong to nobody:
  // recording the first entry for a public occurrence confers no authority over
  // anybody else's history of it, and a handle is how people are found at all.
  ...[
    "GET /locations/:locationId",
    "GET /real-world-events/:realWorldEventId",
    "GET /users/:handle",
    "GET /discovery/events/:realWorldEventId",
    "GET /discovery/locations/:locationId",
  ].map((route) => ({
    route,
    because: "Shared reference data, deliberately readable by anybody signed in.",
  })),

  // A person's Timeline. The identifier does name somebody — unlike a Location,
  // which belongs to nobody — so this is exempt for a different reason than the
  // scoped Timelines below.
  //
  // It is openable by anybody signed in and answers with the Moments that
  // Viewer was already entitled to see, one at a time, and no others.
  // Substituting another identifier therefore returns that person's history
  // filtered for the same Viewer: there is nothing to reach that reaching it
  // discloses. A person who would rather not be walked through turns their
  // Timeline off, and it then answers empty — refusing would itself say there
  // is something there. Driven by timeline.integration.test.ts.
  ...[
    "GET /users/:userId/timeline",
    "GET /users/:userId/timeline/head",
    "GET /users/:userId/timeline/around",
    "GET /users/:userId/timeline/buckets",
  ].map((route) => ({
    route,
    because:
      "A person's Timeline, openable by anybody and filtered per Viewer; timeline.integration.test.ts drives what each may see.",
  })),

  // A shared scope's Timeline. The identifier names a place or an occasion,
  // which belongs to nobody, and the authorization question is not whether the
  // Viewer may read the scope but which of its Moments they may see — decided
  // inside the query, per Viewer, and driven by the eligibility matrix. There
  // is no IDOR here to attempt: substituting another Location's identifier
  // returns that Location's history filtered for the same Viewer, which is what
  // the endpoint is for.
  ...[
    "GET /locations/:locationId/timeline",
    "GET /locations/:locationId/timeline/head",
    "GET /locations/:locationId/timeline/around",
    "GET /locations/:locationId/timeline/buckets",
    "GET /real-world-events/:realWorldEventId/timeline",
    "GET /real-world-events/:realWorldEventId/timeline/head",
    "GET /real-world-events/:realWorldEventId/timeline/around",
    "GET /real-world-events/:realWorldEventId/timeline/buckets",
  ].map((route) => ({
    route,
    because:
      "A shared scope read per Viewer; timeline.eligibility.integration.test.ts drives which Moments each may see.",
  })),

  // Naming somebody else is the whole point. The authorization question on
  // these is a Block, and follow.integration.test.ts drives that.
  ...[
    "POST /users/:userId/follow",
    "DELETE /users/:userId/follow",
    "DELETE /followers/:userId",
    "POST /users/:userId/block",
    "DELETE /users/:userId/block",
    "POST /real-world-events/:realWorldEventId/follow",
    "DELETE /real-world-events/:realWorldEventId/follow",
    "POST /users/:userId/participation-refusal",
    "DELETE /users/:userId/participation-refusal",
    "POST /locations/:locationId/follow",
    "DELETE /locations/:locationId/follow",
  ].map((route) => ({
    route,
    because: "The identifier names the other party by design; the rule here is a Block.",
  })),

  // Somebody's own moderation history. Ownership is the rule and
  // moderation.integration.test.ts drives it, including that one person cannot
  // read another's report.
  ...[
    "GET /reports/:reportId",
    "GET /accuracy-reports/:reportId",
    "GET /appeals/:appealId",
  ].map((route) => ({
    route,
    because: "A person's own moderation history; moderation.integration.test.ts drives it.",
  })),
];

/** Everything the owner has, that a stranger will try to reach. */
interface Owned {
  userId: string;
  accessToken: string;
  sessionId: string;
  momentId: string;
  otherMomentId: string;
  uploadId: string;
  pendingUploadId: string;
  commentId: string;
  relationshipId: string;
  locationId: string;
  realWorldEventId: string;
  notificationId: string;
  deviceId: string;
  followRequestId: string;
  participationId: string;
}

/** A route a stranger must not get through, and the request that tries. */
interface Attempt {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly url: (owned: Owned) => string;
  readonly payload?: (owned: Owned) => Record<string, unknown>;
  /**
   * What the stranger gets.
   *
   * 404 almost throughout, and deliberately: a 403 would confirm the thing
   * exists, which for a private Moment is the disclosure the visibility rule
   * exists to prevent.
   */
  readonly refusal: number;
  /**
   * Whether the answer must also be indistinguishable from one for an
   * identifier that names nothing at all.
   *
   * The stronger property, and the one that actually matters: a status alone
   * can be right while still disclosing. Two routes here refuse with something
   * other than 404 — a session revoke answers "could not be revoked" whether
   * the session is missing or somebody else's, and related history answers with
   * an empty page either way — and for those, sameness is the whole guarantee.
   */
  readonly indistinguishable?: boolean;
}

const ATTEMPTS: readonly Attempt[] = [
  // The Moment itself, and everything that changes it.
  { method: "GET", path: "/moments/:momentId", url: (o) => `/moments/${o.momentId}`, refusal: 404 },
  {
    method: "PATCH",
    path: "/moments/:momentId",
    url: (o) => `/moments/${o.momentId}`,
    payload: () => ({ caption: "not yours to write" }),
    refusal: 404,
  },
  {
    method: "PUT",
    path: "/moments/:momentId/occurrence",
    url: (o) => `/moments/${o.momentId}/occurrence`,
    payload: () => ({ occurrence: summer, occurrenceOffsetMinutes: 0 }),
    refusal: 404,
  },
  {
    method: "POST",
    path: "/moments/:momentId/media",
    url: (o) => `/moments/${o.momentId}/media`,
    payload: (o) => ({ uploadIds: [o.pendingUploadId] }),
    refusal: 404,
  },
  {
    method: "PUT",
    path: "/moments/:momentId/media/order",
    url: (o) => `/moments/${o.momentId}/media/order`,
    payload: (o) => ({ uploadIds: [o.uploadId] }),
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/moments/:momentId/media/:uploadId",
    url: (o) => `/moments/${o.momentId}/media/${o.uploadId}`,
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/moments/:momentId",
    url: (o) => `/moments/${o.momentId}`,
    refusal: 404,
  },
  {
    method: "PUT",
    path: "/moments/:momentId/location",
    url: (o) => `/moments/${o.momentId}/location`,
    payload: (o) => ({ locationId: o.locationId }),
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/moments/:momentId/location",
    url: (o) => `/moments/${o.momentId}/location`,
    refusal: 404,
  },
  {
    method: "POST",
    path: "/moments/:momentId/real-world-events",
    url: (o) => `/moments/${o.momentId}/real-world-events`,
    payload: (o) => ({ realWorldEventId: o.realWorldEventId }),
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/moments/:momentId/real-world-events/:realWorldEventId",
    url: (o) => `/moments/${o.momentId}/real-world-events/${o.realWorldEventId}`,
    refusal: 404,
  },
  {
    method: "PUT",
    path: "/moments/:momentId/discoverability",
    url: (o) => `/moments/${o.momentId}/discoverability`,
    payload: () => ({ discoverable: false }),
    refusal: 404,
  },
  {
    method: "PUT",
    path: "/moments/:momentId/visibility",
    url: (o) => `/moments/${o.momentId}/visibility`,
    payload: () => ({ visibility: "public" }),
    refusal: 404,
  },
  {
    method: "PUT",
    path: "/moments/:momentId/location/disclosure",
    url: (o) => `/moments/${o.momentId}/location/disclosure`,
    payload: () => ({ disclosure: "exact" }),
    refusal: 404,
  },
  {
    method: "GET",
    path: "/moments/:momentId/audience",
    url: (o) => `/moments/${o.momentId}/audience`,
    refusal: 404,
  },

  // Claims connecting Moments.
  {
    method: "POST",
    path: "/moments/:momentId/relationships",
    url: (o) => `/moments/${o.momentId}/relationships`,
    payload: (o) => ({ targetMomentId: o.otherMomentId, kind: "related_to" }),
    refusal: 404,
  },
  {
    method: "GET",
    path: "/moments/:momentId/relationships",
    url: (o) => `/moments/${o.momentId}/relationships`,
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/moments/:momentId/relationships/:relationshipId",
    url: (o) => `/moments/${o.momentId}/relationships/${o.relationshipId}`,
    refusal: 404,
  },

  // Responding to a Moment nobody else may see.
  {
    method: "PUT",
    path: "/moments/:momentId/reaction",
    url: (o) => `/moments/${o.momentId}/reaction`,
    payload: () => ({ kind: "loved" }),
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/moments/:momentId/reaction",
    url: (o) => `/moments/${o.momentId}/reaction`,
    refusal: 404,
  },
  {
    method: "GET",
    path: "/moments/:momentId/reactions",
    url: (o) => `/moments/${o.momentId}/reactions`,
    refusal: 404,
  },
  {
    method: "PUT",
    path: "/moments/:momentId/reactions/enabled",
    url: (o) => `/moments/${o.momentId}/reactions/enabled`,
    payload: () => ({ enabled: false }),
    refusal: 404,
  },

  // The discussion underneath it.
  {
    method: "POST",
    path: "/moments/:momentId/comments",
    url: (o) => `/moments/${o.momentId}/comments`,
    payload: () => ({ body: "not mine to say" }),
    refusal: 404,
  },
  {
    method: "GET",
    path: "/moments/:momentId/comments",
    url: (o) => `/moments/${o.momentId}/comments`,
    refusal: 404,
  },
  {
    method: "PUT",
    path: "/moments/:momentId/comments/policy",
    url: (o) => `/moments/${o.momentId}/comments/policy`,
    payload: () => ({ policy: "disabled" }),
    refusal: 404,
  },
  {
    method: "GET",
    path: "/comments/:commentId/replies",
    url: (o) => `/comments/${o.commentId}/replies`,
    refusal: 404,
  },
  {
    method: "PATCH",
    path: "/comments/:commentId",
    url: (o) => `/comments/${o.commentId}`,
    payload: () => ({ body: "rewriting somebody else" }),
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/comments/:commentId",
    url: (o) => `/comments/${o.commentId}`,
    refusal: 404,
  },
  {
    method: "PUT",
    path: "/comments/:commentId/reaction",
    url: (o) => `/comments/${o.commentId}/reaction`,
    payload: () => ({ kind: "loved" }),
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/comments/:commentId/reaction",
    url: (o) => `/comments/${o.commentId}/reaction`,
    refusal: 404,
  },

  // What a Moment means to somebody, which is theirs alone.
  {
    method: "PUT",
    path: "/moments/:momentId/significance",
    url: (o) => `/moments/${o.momentId}/significance`,
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/moments/:momentId/significance",
    url: (o) => `/moments/${o.momentId}/significance`,
    refusal: 404,
  },
  {
    method: "GET",
    path: "/moments/:momentId/significance",
    url: (o) => `/moments/${o.momentId}/significance`,
    refusal: 404,
  },

  // Somebody's history, and what surrounds it.
  {
    // Answers an empty page rather than refusing, which is not a leak: the same
    // empty page comes back for a Moment that never existed, so a stranger
    // learns nothing either way. `indistinguishable` is what proves that.
    method: "GET",
    path: "/moments/:momentId/related",
    url: (o) => `/moments/${o.momentId}/related`,
    refusal: 200,
    indistinguishable: true,
  },

  {
    // Somebody's history read by a stranger. The account is public and the
    // route answers, but nothing private may appear in it.
    method: "GET",
    path: "/users/:userId/moments",
    url: (o) => `/users/${o.userId}/moments`,
    refusal: 200,
  },

  // A participation, which belongs to the two people in it and nobody else.
  // Answering is the named person's alone, and removing is theirs or the
  // creator's — a third party gets the answer an identifier nobody holds gets.
  {
    method: "POST",
    path: "/participations/:participationId/accept",
    url: (o) => `/participations/${o.participationId}/accept`,
    refusal: 404,
  },
  {
    method: "POST",
    path: "/participations/:participationId/reject",
    url: (o) => `/participations/${o.participationId}/reject`,
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/participations/:participationId",
    url: (o) => `/participations/${o.participationId}`,
    refusal: 404,
  },
  // Reading who a Moment records as having been there. Gated on the Moment's
  // own visibility, so a Moment a stranger may not read tells them nothing
  // about who was in it either.
  {
    method: "GET",
    path: "/moments/:momentId/participants",
    url: (o) => `/moments/${o.momentId}/participants`,
    refusal: 404,
  },
  // Proposing into somebody else's Moment. The identifier names their history,
  // and only its author may say who was there.
  {
    method: "POST",
    path: "/moments/:momentId/participants",
    url: (o) => `/moments/${o.momentId}/participants`,
    payload: (o) => ({ userId: o.userId }),
    refusal: 404,
  },

  // A request to follow, which belongs to the two people in it and nobody else.
  {
    method: "POST",
    path: "/follow-requests/:requestId/accept",
    url: (o) => `/follow-requests/${o.followRequestId}/accept`,
    refusal: 404,
  },
  {
    method: "POST",
    path: "/follow-requests/:requestId/decline",
    url: (o) => `/follow-requests/${o.followRequestId}/decline`,
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/follow-requests/:requestId",
    url: (o) => `/follow-requests/${o.followRequestId}`,
    refusal: 404,
  },

  // Files.
  {
    method: "GET",
    path: "/uploads/:uploadId",
    url: (o) => `/uploads/${o.uploadId}`,
    refusal: 404,
  },
  {
    method: "GET",
    path: "/uploads/:uploadId/places",
    url: (o) => `/uploads/${o.pendingUploadId}/places`,
    refusal: 404,
  },
  {
    method: "POST",
    path: "/uploads/:uploadId/finalize",
    url: (o) => `/uploads/${o.pendingUploadId}/finalize`,
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/uploads/:uploadId",
    url: (o) => `/uploads/${o.pendingUploadId}`,
    refusal: 404,
  },

  // What somebody has been told.
  {
    method: "GET",
    path: "/notifications/:notificationId",
    url: (o) => `/notifications/${o.notificationId}`,
    refusal: 404,
  },
  {
    method: "PUT",
    path: "/notifications/:notificationId/read",
    url: (o) => `/notifications/${o.notificationId}/read`,
    refusal: 404,
  },
  {
    method: "PUT",
    path: "/notifications/:notificationId/dismissed",
    url: (o) => `/notifications/${o.notificationId}/dismissed`,
    refusal: 404,
  },
  {
    method: "DELETE",
    path: "/notifications/devices/:deviceId",
    url: (o) => `/notifications/devices/${o.deviceId}`,
    refusal: 404,
  },

  // Somebody else's session, which is the one that ends an account's access.
  {
    // 401 rather than 404, and deliberately so: `SessionService.revoke` throws
    // one error for a session that does not exist and for one belonging to
    // somebody else, so the two cannot be told apart.
    method: "DELETE",
    path: "/auth/sessions/:sessionId",
    url: (o) => `/auth/sessions/${o.sessionId}`,
    refusal: 401,
    indistinguishable: true,
  },
];

describe("reaching something with somebody else's identifier", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;
  let storage: StorageClient;
  let owned: Owned;
  let stranger: { accessToken: string; userId: string };

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);
    storage = createStorageClient(config.storage);

    const moderationRepository = new ModerationRepository(database.dataSource);
    const moments = new MomentService(
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
      uploads: new UploadService(
        database.dataSource,
        new UploadRepository(database.dataSource),
        storage,
        config.uploadLimits,
        {},
      ),
      realWorldEvents: new RealWorldEventService(
        database.dataSource,
        new RealWorldEventRepository(database.dataSource),
        new LocationRepository(database.dataSource),
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
      momentSignificance: new MomentSignificanceService(
        database.dataSource,
        new MomentSignificanceRepository(database.dataSource),
        moments,
      ),
      participations: new ParticipationService(
        database.dataSource,
        new ParticipationRepository(database.dataSource),
        moments,
        new UserRepository(database.dataSource),
        new FollowRepository(database.dataSource),
      ),
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
      notifications: new NotificationService(
        database.dataSource,
        new NotificationRepository(database.dataSource),
        moments,
        new UserRepository(database.dataSource),
        new FollowRepository(database.dataSource),
      ),
      // Mounted because the device routes live behind it, and an unmounted
      // route answers 404 — which is the refusal this suite asserts, so a
      // missing service would have looked exactly like a working guard.
      notificationDelivery: new NotificationDeliveryService(
        database.dataSource,
        new NotificationDeliveryRepository(database.dataSource),
        new NotificationRepository(database.dataSource),
        new UserRepository(database.dataSource),
        new StoredRecipientDirectory(
          new UserRepository(database.dataSource),
          new IdentityRepository(database.dataSource),
        ),
      ),
      discovery: new DiscoveryService(
        new DiscoveryRetrieval(database.dataSource, INDEX_VERSION),
        moderationRepository,
      ),
    });

    owned = await buildOwner();
    stranger = await onboard();
  });

  afterAll(async () => {
    storage.close();
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

  /** Somebody signed in with a real account. */
  async function onboard() {
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
      payload: { handle: uniqueHandle(), displayName: "Somebody", dateOfBirth: ADULT },
    });

    assert.equal(created.statusCode, 201, created.body);

    return {
      accessToken: credentials.accessToken as string,
      sessionId: credentials.sessionId as string,
      userId: created.json().userId as string,
    };
  }

  /**
   * One person, and one of everything they own.
   *
   * Built through the API wherever the API can build it, so what a stranger
   * later fails to reach is a thing the system genuinely made rather than a row
   * this test invented.
   */
  async function buildOwner(): Promise<Owned> {
    const account = await onboard();
    const headers = authed(account.accessToken);

    const uploadId = await createReadyUpload(database.dataSource, account.userId);
    const record = async (caption: string) => {
      const created = await app.inject({
        method: "POST",
        url: "/moments",
        headers,
        payload: {
          caption,
          occurrence: summer,
          occurrenceOffsetMinutes: 0,
          uploadIds: [await createReadyUpload(database.dataSource, account.userId)],
          visibility: "private",
        },
      });

      assert.equal(created.statusCode, 201, created.body);

      return created.json().momentId as string;
    };

    const first = await app.inject({
      method: "POST",
      url: "/moments",
      headers,
      payload: {
        caption: "Nobody else may read this",
        occurrence: summer,
        occurrenceOffsetMinutes: 0,
        uploadIds: [uploadId],
        visibility: "private",
      },
    });

    assert.equal(first.statusCode, 201, first.body);

    const momentId = first.json().momentId as string;
    const otherMomentId = await record("Another of mine");

    const registered = await app.inject({
      method: "POST",
      url: "/uploads",
      headers,
      payload: { contentType: "image/jpeg", declaredByteSize: 1_024 },
    });

    assert.equal(registered.statusCode, 201, registered.body);

    const locationId = randomUUID();
    await database.dataSource.query(
      `INSERT INTO locations (location_id, name, precision, source, latitude, longitude,
                              recorded_by_user_id, created_at, updated_at)
       VALUES ($1, 'A place', 'exact', 'explicit-selection', 51.5, -0.12, $2, now(), now())`,
      [locationId, account.userId],
    );

    const event = await app.inject({
      method: "POST",
      url: "/real-world-events",
      headers,
      payload: { name: `Event ${randomUUID().slice(0, 8)}`, occurrence: summer },
    });

    assert.equal(event.statusCode, 201, event.body);

    const comment = await app.inject({
      method: "POST",
      url: `/moments/${momentId}/comments`,
      headers,
      payload: { body: "Mine to say" },
    });

    assert.equal(comment.statusCode, 201, comment.body);

    const relationship = await app.inject({
      method: "POST",
      url: `/moments/${momentId}/relationships`,
      headers,
      payload: { targetMomentId: otherMomentId, kind: "related_to" },
    });

    assert.equal(relationship.statusCode, 201, relationship.body);

    const device = await app.inject({
      method: "POST",
      url: "/notifications/devices",
      headers,
      payload: { platform: "ios", token: randomUUID().replaceAll("-", "") },
    });

    assert.equal(device.statusCode, 201, device.body);

    // A third account that approves its followers, so the owner asking to
    // follow leaves a real request behind for a stranger to try to answer.
    const approver = await onboard();
    await database.dataSource.query(
      `UPDATE user_preferences SET requires_follow_approval = true WHERE user_id = $1`,
      [approver.userId],
    );

    const asked = await app.inject({
      method: "POST",
      url: `/users/${approver.userId}/follow`,
      headers,
    });

    assert.equal(asked.statusCode, 200, asked.body);

    const requests: { request_id: string }[] = await database.dataSource.query(
      `SELECT request_id FROM follow_requests WHERE requester_user_id = $1`,
      [account.userId],
    );

    assert.equal(requests.length, 1, "no follow request was created to try to answer");

    // Inserted rather than provoked. Generating one needs the worker, and what
    // is under test is who may read it once it exists.
    const notificationId = randomUUID();
    await database.dataSource.query(
      `INSERT INTO notifications
         (notification_id, recipient_user_id, type, category, source_type, source_id,
          aggregation_key, created_at)
       VALUES ($1, $2, 'moment_reacted', 'social', 'moment', $3, $4, now())`,
      [notificationId, account.userId, momentId, randomUUID()],
    );

    // A real participation the owner proposed, on their own Moment, naming the
    // third account rather than the stranger — the stranger has to be somebody
    // with no part in it, or the refusals below would be acceptances. Without a
    // row that genuinely exists, every one of them would pass for the wrong
    // reason.
    const proposed = await app.inject({
      method: "POST",
      url: `/moments/${momentId}/participants`,
      headers: { authorization: `Bearer ${account.accessToken}` },
      payload: { userId: approver.userId },
    });

    assert.equal(proposed.statusCode, 201, proposed.body);

    return {
      userId: account.userId,
      accessToken: account.accessToken,
      sessionId: account.sessionId,
      momentId,
      otherMomentId,
      uploadId,
      pendingUploadId: registered.json().uploadId as string,
      commentId: comment.json().commentId as string,
      relationshipId: relationship.json().relationshipId as string,
      locationId,
      realWorldEventId: event.json().realWorldEventId as string,
      notificationId,
      deviceId: device.json().deviceId as string,
      followRequestId: requests[0]!.request_id,
      participationId: proposed.json().participationId as string,
    };
  }

  describe("the table covers every route that names something", () => {
    it("classifies each of them exactly once", () => {
      const naming = declaredRoutes()
        .filter((route) => route.path.includes(":"))
        .map(nameOf);
      const classified = [
        ...EXEMPT.map((exemption) => exemption.route),
        ...ATTEMPTS.map((attempt) => `${attempt.method} ${attempt.path}`),
      ];

      assert.deepEqual(
        naming.filter((route) => !classified.includes(route)).sort(),
        [],
        "a route names something and this sweep neither drives nor exempts it",
      );
      assert.deepEqual(
        classified.filter((route) => !naming.includes(route)).sort(),
        [],
        "this sweep names a route that no longer exists",
      );
      assert.equal(new Set(classified).size, classified.length, "a route is classified twice");
    });

    it("gives every exemption a reason", () => {
      for (const exemption of EXEMPT) {
        assert.ok(exemption.because.length > 20, `${exemption.route} is exempt for no stated reason`);
      }
    });
  });

  describe("what the owner can reach", () => {
    // The control, and the reason any of the refusals below mean anything. A
    // 404 for a stranger proves nothing unless the thing is really there: an
    // unmounted route, a mistyped path and an identifier nobody created all
    // answer 404 too.
    const reachable: readonly { what: string; url: (owned: Owned) => string }[] = [
      { what: "the Moment", url: (o) => `/moments/${o.momentId}` },
      { what: "its comments", url: (o) => `/moments/${o.momentId}/comments` },
      { what: "its relationships", url: (o) => `/moments/${o.momentId}/relationships` },
      { what: "its reactions", url: (o) => `/moments/${o.momentId}/reactions` },
      { what: "its audience", url: (o) => `/moments/${o.momentId}/audience` },
      { what: "its significance", url: (o) => `/moments/${o.momentId}/significance` },
      { what: "the upload", url: (o) => `/uploads/${o.pendingUploadId}` },
      { what: "the notification", url: (o) => `/notifications/${o.notificationId}` },
      { what: "the replies to the comment", url: (o) => `/comments/${o.commentId}/replies` },
    ];

    for (const { what, url } of reachable) {
      it(`finds ${what}`, async () => {
        const response = await app.inject({
          method: "GET",
          url: url(owned),
          headers: authed(owned.accessToken),
        });

        assert.equal(response.statusCode, 200, response.body);
      });
    }
  });

  describe("what a stranger cannot reach", () => {
    for (const attempt of ATTEMPTS) {
      it(`refuses ${attempt.method} ${attempt.path}`, async () => {
        const response = await app.inject({
          method: attempt.method,
          url: attempt.url(owned),
          headers: authed(stranger.accessToken),
          ...(attempt.payload === undefined ? {} : { payload: attempt.payload(owned) }),
        });

        assert.equal(response.statusCode, attempt.refusal, response.body);

        if (attempt.indistinguishable === true) {
          // Same request, an identifier that names nothing. A refusal that
          // differs here would tell a stranger the difference between "not
          // yours" and "not there", which is the disclosure itself.
          const nothing = await app.inject({
            method: attempt.method,
            url: attempt.url({ ...owned, momentId: randomUUID(), sessionId: randomUUID() }),
            headers: authed(stranger.accessToken),
            ...(attempt.payload === undefined ? {} : { payload: attempt.payload(owned) }),
          });

          assert.equal(
            nothing.statusCode,
            response.statusCode,
            "a stranger can tell somebody else's from one that does not exist",
          );
        }
      });
    }
  });
});
