import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Permission, Role } from "@chronologity/contracts";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { MAILPIT, testAppConfig } from "../../testing/app-config.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { declaredRoutes, nameOf } from "../../testing/routes.js";
import { ModerationRepository } from "../moderation/moderation.repository.js";
import { ModerationService } from "../moderation/moderation.service.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { ROLE_PERMISSIONS } from "./authorization.policy.js";
import { AuthorizationRepository } from "./authorization.repository.js";
import { AuthorizationService } from "./authorization.service.js";

/**
 * Who may reach a route that requires a permission.
 *
 * Authorization has been tested since it was written — a hundred and fifty-eight
 * refusals across fourteen suites — and none of that could answer the only
 * question worth asking of it: what is not covered. Each was written beside the
 * feature it belongs to, so a route added tomorrow with its guard forgotten
 * breaks nothing.
 *
 * This is table-driven for that reason, and the table is checked against the
 * routes the application declares rather than maintained by hand. A new guarded
 * route with no entry fails here.
 *
 * Four cases each, because three of them are the ways in:
 *
 * - nobody at all;
 * - somebody signed in with no roles;
 * - somebody signed in holding a *different* permission, which is the case a
 *   hierarchy would quietly grant and this system deliberately does not;
 * - somebody holding the right one, who must get past.
 *
 * Every request is schema-valid even when it is expected to be refused. Fastify
 * validates before `preHandler`, so a malformed body answers 400 and never
 * reaches the guard — a matrix built on invalid requests would asserting
 * nothing about authorization at all.
 *
 * Requires `pnpm infra:up`. Run with `pnpm test:integration`.
 */

const config = testAppConfig("permission-matrix-integration");

const ADULT = "1990-04-12";
const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

/**
 * A guarded route, and a request that satisfies its schema.
 *
 * The identifiers are invented rather than seeded. What is under test is the
 * guard, which runs before the handler ever looks anything up — so a holder of
 * the permission getting 404 for a report that does not exist is a pass, and
 * the alternative would be seeding fourteen fixtures to prove nothing extra.
 */
interface GuardedRequest {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly url: string;
  readonly payload?: Record<string, unknown>;
}

const REQUESTS: readonly GuardedRequest[] = [
  {
    method: "PUT",
    path: "/users/:userId/roles/:role",
    url: `/users/${randomUUID()}/roles/moderator`,
    payload: { reason: "matrix" },
  },
  {
    method: "DELETE",
    path: "/users/:userId/roles/:role",
    url: `/users/${randomUUID()}/roles/moderator`,
  },
  { method: "GET", path: "/users/:userId/roles", url: `/users/${randomUUID()}/roles` },
  { method: "GET", path: "/moderation/reports", url: "/moderation/reports" },
  {
    method: "GET",
    path: "/moderation/reports/:reportId",
    url: `/moderation/reports/${randomUUID()}`,
  },
  {
    method: "PUT",
    path: "/moderation/reports/:reportId",
    url: `/moderation/reports/${randomUUID()}`,
    payload: { status: "under_review" },
  },
  { method: "GET", path: "/moderation/accuracy-reports", url: "/moderation/accuracy-reports" },
  {
    method: "GET",
    path: "/moderation/accuracy-reports/:reportId",
    url: `/moderation/accuracy-reports/${randomUUID()}`,
  },
  {
    method: "PUT",
    path: "/moderation/accuracy-reports/:reportId",
    url: `/moderation/accuracy-reports/${randomUUID()}`,
    payload: { status: "resolved" },
  },
  {
    method: "PUT",
    path: "/moderation/subjects/:subjectType/:subjectId/state",
    url: `/moderation/subjects/moment/${randomUUID()}/state`,
    payload: { state: "temporarily_unavailable", reason: "matrix" },
  },
  {
    method: "PUT",
    path: "/users/:userId/suspension",
    url: `/users/${randomUUID()}/suspension`,
    payload: { suspended: true, reason: "matrix" },
  },
  { method: "GET", path: "/moderation/appeals", url: "/moderation/appeals" },
  {
    method: "GET",
    path: "/moderation/appeals/:appealId",
    url: `/moderation/appeals/${randomUUID()}`,
  },
  {
    method: "PUT",
    path: "/moderation/appeals/:appealId",
    url: `/moderation/appeals/${randomUUID()}`,
    payload: { outcome: "upheld", resolution: "matrix" },
  },
];

/**
 * A role that grants a permission, and one that does not.
 *
 * Both are read from `ROLE_PERMISSIONS` rather than written down here, so the
 * no-hierarchy rule this system states is the rule this test applies. An
 * administrator is not a moderator: that is what makes "holds a different
 * permission" a real case rather than a synonym for "holds none".
 *
 * @param permission - What the route requires.
 * @returns The role to grant, and a role that confers something else entirely.
 * @throws {Error} If no role grants it, or every role does — either would make
 *   one of the four cases meaningless.
 */
function rolesFor(permission: string): { granting: Role; other: Role } {
  const roles = Object.keys(ROLE_PERMISSIONS) as Role[];
  const granting = roles.find((role) =>
    ROLE_PERMISSIONS[role].includes(permission as Permission),
  );
  const other = roles.find(
    (role) =>
      role !== "user" &&
      role !== granting &&
      !ROLE_PERMISSIONS[role].includes(permission as Permission),
  );

  if (granting === undefined) {
    throw new Error(`No role grants ${permission}`);
  }

  if (other === undefined) {
    throw new Error(`Every role grants ${permission}, so it cannot be withheld`);
  }

  return { granting, other };
}

describe("reaching a route that requires a permission", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;
  let authorization: AuthorizationService;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);
    authorization = new AuthorizationService(
      database.dataSource,
      new AuthorizationRepository(database.dataSource),
    );

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, new UserRepository(database.dataSource), {
        minimumAgeYears: config.minimumAgeYears,
      }),
      authorization,
      moderation: new ModerationService(
        database.dataSource,
        new ModerationRepository(database.dataSource),
      ),
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

  /** Somebody signed in with a real account and no roles at all. */
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
      headers: { authorization: `Bearer ${credentials.accessToken}` },
      payload: { handle: uniqueHandle(), displayName: "Matrix", dateOfBirth: ADULT },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { accessToken: credentials.accessToken as string, userId: created.json().userId };
  };

  /** Somebody holding exactly one role. */
  const onboardHolding = async (role: Role) => {
    const account = await onboard();

    await authorization.assign(account.userId, role as "moderator" | "administrator", undefined, "permission matrix", {
      traceId: randomUUID(),
      actor: undefined,
      receivedAt: new Date(),
    });

    return account;
  };

  const call = async (request: GuardedRequest, accessToken?: string) =>
    app.inject({
      method: request.method,
      url: request.url,
      headers: accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` },
      ...(request.payload === undefined ? {} : { payload: request.payload }),
    });

  describe("the table covers what the application guards", () => {
    it("has an entry for every guarded route, and guards every entry", () => {
      // The point of the exercise. Without this the matrix is a list somebody
      // wrote once, and a fifteenth guarded route would be as untested as the
      // fourteen were before it.
      const guarded = declaredRoutes().filter((route) => route.permission !== undefined);
      const covered = new Set(REQUESTS.map((request) => `${request.method} ${request.path}`));

      assert.deepEqual(
        guarded.map(nameOf).filter((route) => !covered.has(route)).sort(),
        [],
        "a route requires a permission and this matrix does not exercise it",
      );
      assert.deepEqual(
        [...covered].filter((route) => !guarded.map(nameOf).includes(route)).sort(),
        [],
        "this matrix names a route that no longer requires a permission",
      );
    });

    it("covers every permission the platform defines", () => {
      // A permission nothing guards is a permission that cannot be enforced,
      // and it would be invisible from the route side alone.
      const guarded = new Set(
        declaredRoutes()
          .map((route) => route.permission)
          .filter((permission): permission is string => permission !== undefined),
      );
      const defined = new Set(Object.values(ROLE_PERMISSIONS).flat());

      assert.deepEqual(
        [...defined].filter((permission) => !guarded.has(permission)).sort(),
        [],
        "a permission is defined and no route requires it",
      );
    });
  });

  describe("a refusal that must leave evidence", () => {
    // Two routes use `guardRecording` rather than `requirePermission`. It
    // refuses identically and writes the attempt down first, because a route
    // that names a subject loses something a later review would want: who tried
    // to moderate whom. Nothing proved it did — the difference between the two
    // guards was invisible from outside, which is also how a survey of
    // `requirePermission` concluded these two permissions were unenforced.
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

    const RECORDING = [
      "/moderation/subjects/:subjectType/:subjectId/state",
      "/users/:userId/suspension",
    ].map((path) => REQUESTS.find((candidate) => candidate.path === path)!);

    for (const request of RECORDING) {
      it(`records who was refused by ${request.method} ${request.path}`, async () => {
        const nobody = await onboard();
        const subjectId = UUID.exec(request.url)?.[0];

        assert.notEqual(subjectId, undefined, "the request names no subject");
        assert.equal((await call(request, nobody.accessToken)).statusCode, 403);

        const rows: { actor_user_id: string; outcome: string; reason: string }[] =
          await database.dataSource.query(
            `SELECT actor_user_id, outcome, reason FROM moderation_actions
              WHERE subject_id = $1 AND actor_user_id = $2`,
            [subjectId, nobody.userId],
          );

        assert.equal(rows.length, 1, "the refusal left no evidence");
        assert.equal(rows[0]?.outcome, "failure");
        assert.match(rows[0]?.reason ?? "", /without holding it/);
      });
    }
  });

  describe("each guarded route", () => {
    for (const request of REQUESTS) {
      const permission = declaredRoutes().find(
        (route) => nameOf(route) === `${request.method} ${request.path}`,
      )?.permission;

      describe(`${request.method} ${request.path}`, () => {
        it("refuses somebody with no session", async () => {
          assert.equal((await call(request)).statusCode, 401);
        });

        it("refuses somebody signed in with no roles", async () => {
          const nobody = await onboard();

          assert.equal((await call(request, nobody.accessToken)).statusCode, 403);
        });

        it("refuses somebody holding a different permission", async () => {
          // The case a role hierarchy would grant by accident. There is no
          // hierarchy here, and this is where that stops being a comment.
          const { other } = rolesFor(permission!);
          const wrong = await onboardHolding(other);

          assert.equal((await call(request, wrong.accessToken)).statusCode, 403);
        });

        it("lets somebody holding the permission past the guard", async () => {
          // Past the guard, not necessarily to a result: these identifiers name
          // nothing, so a 404 is the right answer and proves the request got as
          // far as the handler.
          const { granting } = rolesFor(permission!);
          const allowed = await onboardHolding(granting);
          const response = await call(request, allowed.accessToken);

          assert.notEqual(response.statusCode, 401, response.body);
          assert.notEqual(response.statusCode, 403, response.body);
        });
      });
    }
  });
});
