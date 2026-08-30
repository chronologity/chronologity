import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { DERIVATION_VERSION } from "@chronologity/contracts";
import { createAnalytics, type Analytics } from "../../lib/clickhouse/clickhouse.js";
import { migrateAnalytics } from "../../lib/clickhouse/migrations.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { MAILPIT, testAppConfig } from "../../testing/app-config.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { TimelineEligibilityResolver } from "../timeline/timeline.eligibility.js";
import { TimelineReadRepository } from "../timeline/timeline.read.repository.js";
import { TimelineRepository } from "../timeline/timeline.repository.js";
import { TimelineService } from "../timeline/timeline.service.js";
import type { TimelineRow } from "../timeline/timeline-row.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { SavedViewRepository } from "./saved-view.repository.js";
import { SavedViewService } from "./saved-view.service.js";

/**
 * Saved Views, end to end.
 *
 * What is kept is a **perspective on history**, never a list of Moments, so the
 * properties worth proving are all about meaning surviving time and about
 * sharing conferring nothing:
 *
 * - a view reopens meaning what it meant, and a rolling range still rolls;
 * - a view older than the version reading it opens rather than failing;
 * - a link hands over a request, and the history behind it is derived for
 *   whoever followed the link — so the sender's eligibility cannot travel.
 *
 * The Timeline is mounted for real, against real ClickHouse, because the last
 * of those is only true if the whole loop is: save, share, open, read.
 *
 * Requires `pnpm infra:up`.
 */

const config = testAppConfig("saved-views-integration");

const ADULT = "1990-04-12";
const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

describe("saved views", () => {
  let app: FastifyInstance;
  let database: Database;
  let analytics: Analytics;
  let authentication: TestAuthentication;
  let timeline: TimelineRepository;
  const version = `saved-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    analytics = createAnalytics(config.clickhouse);
    await migrateAnalytics(analytics.client);
    timeline = new TimelineRepository(analytics.client, version);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);

    const accounts = new UserRepository(database.dataSource);

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, accounts, {
        minimumAgeYears: config.minimumAgeYears,
      }),
      savedViews: new SavedViewService(
        database.dataSource,
        new SavedViewRepository(database.dataSource),
        accounts,
      ),
      timeline: new TimelineService(
        new TimelineReadRepository(analytics.client, version),
        new TimelineEligibilityResolver(database.dataSource),
      ),
    });
  });

  afterAll(async () => {
    await analytics.client.command({
      query: `DELETE FROM timeline_moments WHERE projection_version = {version: String}`,
      query_params: { version },
    });
    await analytics.client.command({
      query: `DELETE FROM timeline_moment_contexts WHERE projection_version = {version: String}`,
      query_params: { version },
    });
    await app.close();
    await authentication.close();
    await analytics.close();
    await database.close();
  });

  const authed = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  /**
   * A refusal with the one field that differs between any two requests removed.
   *
   * A trace identifier is per-request by construction, so comparing whole bodies
   * would fail whether or not the refusals disclosed anything. What is under
   * test is the code and the wording.
   */
  const refusal = (body: string): Record<string, unknown> => {
    const { traceId: _traceId, ...rest } = JSON.parse(body) as Record<string, unknown>;

    return rest;
  };

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

    return {
      accessToken: credentials.accessToken as string,
      userId: created.json().userId as string,
    };
  };

  /**
   * Save a view, and fail loudly if it would not save.
   */
  const keep = async (
    accessToken: string,
    title: string,
    view: Record<string, unknown>,
  ): Promise<{ savedViewId: string; body: Record<string, unknown> }> => {
    const response = await app.inject({
      method: "POST",
      url: "/saved-views",
      headers: authed(accessToken),
      payload: { title, view },
    });

    assert.equal(response.statusCode, 201, response.body);

    return { savedViewId: response.json().savedViewId as string, body: response.json() };
  };

  /**
   * Put a Moment on somebody's own Timeline, the way the projector writes it.
   */
  const recorded = async (
    authorUserId: string,
    year: number,
    over: Partial<TimelineRow> = {},
  ): Promise<string> => {
    const row: TimelineRow = {
      momentId: randomUUID(),
      authorUserId,
      occurredAt: new Date(`${year}-06-01T00:00:00.000Z`),
      recordedAt: new Date(),
      occurrenceEnd: new Date(`${year}-06-01T00:00:00.000Z`),
      occurrencePrecision: "day",
      occurrenceOffsetMinutes: 0,
      visibility: "public",
      moderationState: "allowed",
      discoverable: true,
      ...over,
    };

    await timeline.project(row);
    await timeline.projectContexts(row, [{ type: "person", id: authorUserId }]);

    return row.momentId;
  };

  describe("keeping one", () => {
    it("keeps what it was asked to keep", async () => {
      const person = await onboard();
      const view = {
        context: { type: "person", id: person.userId },
        perspective: "authored",
        range: { kind: "fixed", from: "1990-01-01T00:00:00.000Z", to: "1999-12-31T23:59:59.000Z" },
        zoom: "decade",
        limit: 25,
      };

      const kept = await keep(person.accessToken, "The nineties", view);
      const read = await app.inject({
        method: "GET",
        url: `/saved-views/${kept.savedViewId}`,
        headers: authed(person.accessToken),
      });

      assert.equal(read.statusCode, 200, read.body);
      assert.equal(read.json().title, "The nineties");
      assert.deepEqual(read.json().view.range, view.range);
      assert.equal(read.json().view.perspective, "authored");
      assert.equal(read.json().view.zoom, "decade");
      assert.equal(read.json().view.limit, 25);
    });

    it("keeps a rolling range rolling", async () => {
      // The whole reason a specification is stored rather than a result. "The
      // last thirty days" saved in June and opened in December must mean
      // December's thirty days; a range resolved on the way in would have
      // become a fixed one silently, and nothing afterwards could tell.
      const person = await onboard();
      const kept = await keep(person.accessToken, "Lately", {
        context: { type: "person", id: person.userId },
        range: { kind: "rolling", unit: "day", count: 30 },
      });

      const read = await app.inject({
        method: "GET",
        url: `/saved-views/${kept.savedViewId}`,
        headers: authed(person.accessToken),
      });

      assert.deepEqual(read.json().view.range, { kind: "rolling", unit: "day", count: 30 });
      assert.equal("from" in read.json().view.range, false, "a rolling range was resolved");
    });

    it("opens one written before the version reading it", async () => {
      // A view stored by an older writer, which had no version to store. It
      // must open — a refusal here is somebody's saved thing failing, which is
      // the case the derivation version exists to migrate rather than reject.
      const person = await onboard();
      const savedViewId = randomUUID();

      await database.dataSource.query(
        `INSERT INTO saved_views (saved_view_id, user_id, title, specification)
         VALUES ($1, $2, 'From before', $3::jsonb)`,
        [savedViewId, person.userId, JSON.stringify({ context: { type: "person", id: person.userId } })],
      );

      const read = await app.inject({
        method: "GET",
        url: `/saved-views/${savedViewId}`,
        headers: authed(person.accessToken),
      });

      assert.equal(read.statusCode, 200, read.body);
      assert.equal(read.json().view.derivationVersion, DERIVATION_VERSION);
    });

    it("lists them newest first", async () => {
      const person = await onboard();
      const context = { type: "person", id: person.userId };

      const first = await keep(person.accessToken, "First", { context });
      const second = await keep(person.accessToken, "Second", { context });

      const listed = await app.inject({
        method: "GET",
        url: "/saved-views",
        headers: authed(person.accessToken),
      });

      assert.equal(listed.statusCode, 200, listed.body);
      assert.deepEqual(
        listed.json().items.map((item: { savedViewId: string }) => item.savedViewId),
        [second.savedViewId, first.savedViewId],
      );
    });

    it("renames it and changes nothing else", async () => {
      const person = await onboard();
      const kept = await keep(person.accessToken, "Untitled", {
        context: { type: "person", id: person.userId },
        perspective: "participated",
      });

      const renamed = await app.inject({
        method: "PATCH",
        url: `/saved-views/${kept.savedViewId}`,
        headers: authed(person.accessToken),
        payload: { title: "Where I was" },
      });

      assert.equal(renamed.statusCode, 200, renamed.body);
      assert.equal(renamed.json().title, "Where I was");
      assert.deepEqual(renamed.json().view, kept.body.view, "renaming moved what it points at");
    });

    it("hides somebody else's behind the same answer as one nobody saved", async () => {
      const owner = await onboard();
      const stranger = await onboard();
      const kept = await keep(owner.accessToken, "Mine", {
        context: { type: "person", id: owner.userId },
      });

      const theirs = await app.inject({
        method: "GET",
        url: `/saved-views/${kept.savedViewId}`,
        headers: authed(stranger.accessToken),
      });
      const nothing = await app.inject({
        method: "GET",
        url: `/saved-views/${randomUUID()}`,
        headers: authed(stranger.accessToken),
      });

      assert.equal(theirs.statusCode, 404, theirs.body);
      assert.equal(nothing.statusCode, theirs.statusCode);
      assert.deepEqual(
        refusal(nothing.body),
        refusal(theirs.body),
        "a stranger can tell not-yours from not-there",
      );
    });

    it("forgets one, and every link to it", async () => {
      const person = await onboard();
      const kept = await keep(person.accessToken, "Passing", {
        context: { type: "person", id: person.userId },
      });
      const share = await app.inject({
        method: "POST",
        url: `/saved-views/${kept.savedViewId}/shares`,
        headers: authed(person.accessToken),
        payload: {},
      });

      assert.equal(share.statusCode, 201, share.body);

      const forgotten = await app.inject({
        method: "DELETE",
        url: `/saved-views/${kept.savedViewId}`,
        headers: authed(person.accessToken),
      });

      assert.equal(forgotten.statusCode, 204, forgotten.body);

      const opened = await app.inject({
        method: "GET",
        url: `/shared-views/${share.json().token as string}`,
        headers: authed(person.accessToken),
      });

      assert.equal(opened.statusCode, 404, "a link to a forgotten view still opened");
    });
  });

  describe("looking at one", () => {
    const visit = async (accessToken: string, savedViewId: string) =>
      app.inject({
        method: "POST",
        url: `/saved-views/${savedViewId}/visits`,
        headers: authed(accessToken),
      });

    const storedFor = async (savedViewId: string) => {
      const rows: {
        new_moment_count: number;
        capped: boolean;
        visited_through: Date | null;
        computed_at: Date | null;
      }[] = await database.dataSource.query(
        `SELECT new_moment_count, capped, visited_through, computed_at
           FROM saved_view_awareness WHERE saved_view_id = $1`,
        [savedViewId],
      );

      return rows[0];
    };

    it("enqueues a view for counting the moment it is saved", async () => {
      // The row exists from the start, so finding the stalest view is one index
      // scan rather than a join against every view that has none.
      const person = await onboard();
      const kept = await keep(person.accessToken, "Fresh", {
        context: { type: "person", id: person.userId },
      });

      const stored = await storedFor(kept.savedViewId);

      assert.ok(stored, "a saved view was not enqueued for counting");
      assert.equal(stored.computed_at, null, "a view was enqueued as though already counted");
    });

    it("says nothing about a view nothing has counted yet", async () => {
      const person = await onboard();
      const kept = await keep(person.accessToken, "Unknown", {
        context: { type: "person", id: person.userId },
      });

      const read = await app.inject({
        method: "GET",
        url: `/saved-views/${kept.savedViewId}`,
        headers: authed(person.accessToken),
      });

      assert.equal(read.json().newMoments, undefined, "an uncounted view reported a count");
      assert.equal(read.json().lastVisitedAt, undefined);
    });

    it("records when somebody looked, and clears what was counted before", async () => {
      const person = await onboard();
      const kept = await keep(person.accessToken, "Looked at", {
        context: { type: "person", id: person.userId },
      });

      await database.dataSource.query(
        `UPDATE saved_view_awareness
            SET new_moment_count = 14, capped = false, computed_at = now()
          WHERE saved_view_id = $1`,
        [kept.savedViewId],
      );

      const visited = await visit(person.accessToken, kept.savedViewId);

      assert.equal(visited.statusCode, 204, visited.body);

      const stored = await storedFor(kept.savedViewId);

      assert.equal(stored?.new_moment_count, 0, "a count survived somebody reading the view");
      assert.ok(stored?.visited_through, "the visit was not recorded against the count");
      assert.equal(
        stored?.computed_at,
        null,
        "an asserted zero was recorded as though it had been counted",
      );

      const read = await app.inject({
        method: "GET",
        url: `/saved-views/${kept.savedViewId}`,
        headers: authed(person.accessToken),
      });

      assert.ok(read.json().lastVisitedAt, "the visit was not presented");
    });

    it("is an act rather than a consequence of reading", async () => {
      // Listing views is not looking at one. A client that prefetched the list
      // would otherwise clear every badge somebody had.
      const person = await onboard();
      const kept = await keep(person.accessToken, "Merely listed", {
        context: { type: "person", id: person.userId },
      });

      await app.inject({
        method: "GET",
        url: `/saved-views/${kept.savedViewId}`,
        headers: authed(person.accessToken),
      });
      await app.inject({ method: "GET", url: "/saved-views", headers: authed(person.accessToken) });

      const stored = await storedFor(kept.savedViewId);

      assert.equal(stored?.visited_through, null, "reading a view counted as looking at it");
    });

    it("does not count as an edit", async () => {
      const person = await onboard();
      const kept = await keep(person.accessToken, "Unedited", {
        context: { type: "person", id: person.userId },
      });

      await visit(person.accessToken, kept.savedViewId);

      const read = await app.inject({
        method: "GET",
        url: `/saved-views/${kept.savedViewId}`,
        headers: authed(person.accessToken),
      });

      assert.equal(
        read.json().updatedAt,
        kept.body.updatedAt,
        "looking at a view was recorded as changing it",
      );
    });

    it("moves the mark forward each time", async () => {
      const person = await onboard();
      const kept = await keep(person.accessToken, "Twice", {
        context: { type: "person", id: person.userId },
      });

      await visit(person.accessToken, kept.savedViewId);
      const first = (await storedFor(kept.savedViewId))?.visited_through;

      await new Promise((resolve) => setTimeout(resolve, 10));
      await visit(person.accessToken, kept.savedViewId);
      const second = (await storedFor(kept.savedViewId))?.visited_through;

      assert.ok(first && second && second > first, "a second visit did not move the mark");
    });

    it("refuses to record a visit to somebody else's view", async () => {
      const owner = await onboard();
      const stranger = await onboard();
      const kept = await keep(owner.accessToken, "Not yours", {
        context: { type: "person", id: owner.userId },
      });

      const theirs = await visit(stranger.accessToken, kept.savedViewId);

      assert.equal(theirs.statusCode, 404, theirs.body);
      assert.equal(
        (await storedFor(kept.savedViewId))?.visited_through,
        null,
        "a stranger moved somebody else's mark",
      );
    });

    it("carries what was counted, and keeps nothing new distinct from not knowing", async () => {
      const person = await onboard();
      const context = { type: "person", id: person.userId };
      const counted = await keep(person.accessToken, "Counted", { context });
      const uncounted = await keep(person.accessToken, "Uncounted", { context });

      await database.dataSource.query(
        `UPDATE saved_view_awareness
            SET new_moment_count = 0, capped = false, computed_at = now()
          WHERE saved_view_id = $1`,
        [counted.savedViewId],
      );

      const listed = await app.inject({
        method: "GET",
        url: "/saved-views",
        headers: authed(person.accessToken),
      });

      const items: { savedViewId: string; newMoments?: { count: number } }[] = listed.json().items;
      const withCount = items.find((item) => item.savedViewId === counted.savedViewId);
      const without = items.find((item) => item.savedViewId === uncounted.savedViewId);

      assert.equal(withCount?.newMoments?.count, 0, "a counted zero was not presented");
      assert.equal(without?.newMoments, undefined, "an uncounted view was presented as up to date");
    });

    it("says nothing about a count taken before the last visit", async () => {
      const person = await onboard();
      const kept = await keep(person.accessToken, "Superseded", {
        context: { type: "person", id: person.userId },
      });

      // Counted against a visit, then looked at again.
      await database.dataSource.query(
        `UPDATE saved_view_awareness
            SET new_moment_count = 9, computed_at = now(), visited_through = now() - interval '1 day'
          WHERE saved_view_id = $1`,
        [kept.savedViewId],
      );
      await database.dataSource.query(
        `UPDATE saved_views SET last_visited_at = now() WHERE saved_view_id = $1`,
        [kept.savedViewId],
      );

      const read = await app.inject({
        method: "GET",
        url: `/saved-views/${kept.savedViewId}`,
        headers: authed(person.accessToken),
      });

      assert.equal(
        read.json().newMoments,
        undefined,
        "a count from before the last visit was still shown",
      );
    });

    it("takes its awareness with it when the view goes", async () => {
      const person = await onboard();
      const kept = await keep(person.accessToken, "Doomed", {
        context: { type: "person", id: person.userId },
      });

      await app.inject({
        method: "DELETE",
        url: `/saved-views/${kept.savedViewId}`,
        headers: authed(person.accessToken),
      });

      assert.equal(await storedFor(kept.savedViewId), undefined, "awareness outlived its view");
    });
  });

  describe("sharing one", () => {
    const shareOf = async (
      accessToken: string,
      savedViewId: string,
      reveals: Record<string, boolean> = {},
    ) => {
      const response = await app.inject({
        method: "POST",
        url: `/saved-views/${savedViewId}/shares`,
        headers: authed(accessToken),
        payload: reveals,
      });

      assert.equal(response.statusCode, 201, response.body);

      return response.json() as { shareId: string; token: string };
    };

    it("says nothing about the sender by default", async () => {
      const sender = await onboard();
      const recipient = await onboard();
      const kept = await keep(sender.accessToken, "A private name for it", {
        context: { type: "person", id: sender.userId },
      });
      const share = await shareOf(sender.accessToken, kept.savedViewId);

      const opened = await app.inject({
        method: "GET",
        url: `/shared-views/${share.token}`,
        headers: authed(recipient.accessToken),
      });

      assert.equal(opened.statusCode, 200, opened.body);
      assert.equal(opened.json().view.context.id, sender.userId);
      assert.equal(opened.json().title, undefined, "the title travelled uninvited");
      assert.equal(opened.json().owner, undefined, "the owner travelled uninvited");
    });

    it("says what the sender chose and no more", async () => {
      const sender = await onboard();
      const recipient = await onboard();
      const kept = await keep(sender.accessToken, "Our summer", {
        context: { type: "person", id: sender.userId },
      });
      const share = await shareOf(sender.accessToken, kept.savedViewId, { revealsTitle: true });

      const opened = await app.inject({
        method: "GET",
        url: `/shared-views/${share.token}`,
        headers: authed(recipient.accessToken),
      });

      assert.equal(opened.json().title, "Our summer");
      assert.equal(opened.json().owner, undefined, "revealing the title revealed the owner too");
    });

    it("lets one view be shared twice on different terms", async () => {
      // What suits a sibling need not suit a colleague, which is why the choice
      // lives on the link rather than on the view.
      const sender = await onboard();
      const recipient = await onboard();
      const kept = await keep(sender.accessToken, "Family", {
        context: { type: "person", id: sender.userId },
      });

      const quiet = await shareOf(sender.accessToken, kept.savedViewId);
      const named = await shareOf(sender.accessToken, kept.savedViewId, {
        revealsTitle: true,
        revealsOwner: true,
      });

      const first = await app.inject({
        method: "GET",
        url: `/shared-views/${quiet.token}`,
        headers: authed(recipient.accessToken),
      });
      const second = await app.inject({
        method: "GET",
        url: `/shared-views/${named.token}`,
        headers: authed(recipient.accessToken),
      });

      assert.equal(first.json().title, undefined);
      assert.equal(second.json().title, "Family");
      assert.equal(second.json().owner.userId, sender.userId);
    });

    it("stops opening once withdrawn, and says no more than a token nobody holds", async () => {
      const sender = await onboard();
      const recipient = await onboard();
      const kept = await keep(sender.accessToken, "Briefly", {
        context: { type: "person", id: sender.userId },
      });
      const share = await shareOf(sender.accessToken, kept.savedViewId);

      const withdrawn = await app.inject({
        method: "DELETE",
        url: `/shares/${share.shareId}`,
        headers: authed(sender.accessToken),
      });

      assert.equal(withdrawn.statusCode, 204, withdrawn.body);

      const after = await app.inject({
        method: "GET",
        url: `/shared-views/${share.token}`,
        headers: authed(recipient.accessToken),
      });
      const never = await app.inject({
        method: "GET",
        url: `/shared-views/${randomUUID().replaceAll("-", "")}`,
        headers: authed(recipient.accessToken),
      });

      assert.equal(after.statusCode, 404, after.body);
      assert.deepEqual(
        refusal(never.body),
        refusal(after.body),
        "a withdrawn link admits it once worked",
      );
    });

    it("shows the sender what they gave out, withdrawn ones included", async () => {
      const sender = await onboard();
      const kept = await keep(sender.accessToken, "Kept count", {
        context: { type: "person", id: sender.userId },
      });
      const share = await shareOf(sender.accessToken, kept.savedViewId);

      await app.inject({
        method: "DELETE",
        url: `/shares/${share.shareId}`,
        headers: authed(sender.accessToken),
      });

      const listed = await app.inject({
        method: "GET",
        url: `/saved-views/${kept.savedViewId}/shares`,
        headers: authed(sender.accessToken),
      });

      assert.equal(listed.statusCode, 200, listed.body);
      assert.equal(listed.json().items.length, 1);
      assert.equal(listed.json().items[0].shareId, share.shareId);
      assert.ok(listed.json().items[0].revokedAt, "a withdrawn link left no record of being taken back");
    });

    it("hands over a request and never any history", async () => {
      // The property the whole design turns on. A shared link carries what to
      // ask for; the asking is done by whoever followed it, as themselves.
      const sender = await onboard();
      const recipient = await onboard();

      await recorded(sender.userId, 1994);

      const kept = await keep(sender.accessToken, "Everything", {
        context: { type: "person", id: sender.userId },
      });
      const share = await shareOf(sender.accessToken, kept.savedViewId);

      const opened = await app.inject({
        method: "GET",
        url: `/shared-views/${share.token}`,
        headers: authed(recipient.accessToken),
      });

      assert.equal(opened.statusCode, 200, opened.body);
      assert.deepEqual(Object.keys(opened.json()), ["view"], "a shared link carried more than a view");
      assert.equal("moments" in opened.json(), false, "history travelled with the link");
    });

    it("derives what the recipient may see, not what the sender may", async () => {
      // Two Moments, one public and one private. The sender saved a view that
      // covers both. Following their link must not admit the recipient to the
      // private one — sharing a perspective is not sharing an eligibility.
      const sender = await onboard();
      const recipient = await onboard();

      const open = await recorded(sender.userId, 1971);
      const shut = await recorded(sender.userId, 1972, { visibility: "private" });

      const kept = await keep(sender.accessToken, "All of it", {
        context: { type: "person", id: sender.userId },
      });
      const share = await shareOf(sender.accessToken, kept.savedViewId);

      const opened = await app.inject({
        method: "GET",
        url: `/shared-views/${share.token}`,
        headers: authed(recipient.accessToken),
      });

      assert.equal(opened.statusCode, 200, opened.body);

      const theirs = await app.inject({
        method: "GET",
        url: `/users/${opened.json().view.context.id as string}/timeline`,
        headers: authed(recipient.accessToken),
      });
      const mine = await app.inject({
        method: "GET",
        url: `/users/${sender.userId}/timeline`,
        headers: authed(sender.accessToken),
      });

      assert.equal(theirs.statusCode, 200, theirs.body);
      assert.deepEqual(
        theirs.json().moments.map((moment: { momentId: string }) => moment.momentId),
        [open],
        "the recipient saw the sender's private history through a shared link",
      );
      assert.deepEqual(
        mine.json().moments.map((moment: { momentId: string }) => moment.momentId).sort(),
        [shut, open].sort(),
        "the sender could not see their own history, so the comparison proves nothing",
      );
    });
  });
});
