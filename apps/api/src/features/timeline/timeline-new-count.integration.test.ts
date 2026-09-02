import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ViewSpecification } from "@chronologity/contracts";
import { createAnalytics, type Analytics } from "../../lib/clickhouse/clickhouse.js";
import { migrateAnalytics } from "../../lib/clickhouse/migrations.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { buildApp } from "../../server/app.js";
import { MAILPIT, testAppConfig } from "../../testing/app-config.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { createLocation } from "../../testing/fixtures.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";
import { TimelineEligibilityResolver } from "@chronologity/timeline-derivation";
import { TimelineReadRepository } from "./timeline.read.repository.js";
import { TimelineRepository } from "./timeline.repository.js";
import { TimelineService } from "./timeline.service.js";
import type { TimelineRow } from "@chronologity/timeline-derivation";

/**
 * Counting what a view has gained since somebody last looked.
 *
 * The one question this answers is what "new" means, and the answer is **newly
 * recorded, never newly occurred**: a Moment added today belonging to 1969 is
 * new, because putting history back where it happened is the point of the
 * product. A mark on occurrence time would miss exactly the additions worth
 * surfacing, and one on projection time would call a rebuilt decade new for
 * every reader at once.
 *
 * The other question is what must never be counted, which is everything the
 * eligibility rule already withholds — with one deliberate exception, tested
 * below: your own history counts what you may not read, because the pages
 * beneath it show those Moments redacted and a count that disagreed with its
 * own pages would be the disclosure it was trying to avoid.
 *
 * Requires `pnpm infra:up`.
 */

const config = testAppConfig("timeline-new-count-integration");

const ADULT = "1990-04-12";
const CHILD = () => {
  const child = new Date();
  child.setUTCFullYear(child.getUTCFullYear() - 14);

  return child.toISOString().slice(0, 10);
};
const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

const CAP = 100;
const LONG_AGO = new Date("2000-01-01T00:00:00.000Z");

describe("how much a view has gained", () => {
  let app: FastifyInstance;
  let database: Database;
  let analytics: Analytics;
  let authentication: TestAuthentication;
  let timeline: TimelineRepository;
  let service: TimelineService;
  const version = `count-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    analytics = createAnalytics(config.clickhouse);
    await migrateAnalytics(analytics.client);
    timeline = new TimelineRepository(analytics.client, version);
    service = new TimelineService(
      new TimelineReadRepository(analytics.client, version),
      new TimelineEligibilityResolver(database.dataSource),
    );

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users: new UserService(database.dataSource, new UserRepository(database.dataSource), {
        minimumAgeYears: config.minimumAgeYears,
      }),
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

  const onboard = async (dateOfBirth = ADULT) => {
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
      payload: { handle: uniqueHandle(), displayName: "Chronicler", dateOfBirth },
    });

    assert.equal(created.statusCode, 201, created.body);

    return {
      accessToken: credentials.accessToken as string,
      userId: created.json().userId as string,
    };
  };

  /**
   * Put a Moment in history, the way the projector writes it.
   *
   * `occurred` and `recorded` are independent on purpose — separating them is
   * the whole subject of this suite.
   */
  const place = async (options: {
    authorUserId: string;
    occurred: string;
    recorded: Date;
    locationId?: string;
    /** Other people whose Timeline this Moment also belongs on. */
    participants?: readonly string[];
    over?: Partial<TimelineRow>;
  }): Promise<TimelineRow> => {
    const row: TimelineRow = {
      momentId: randomUUID(),
      authorUserId: options.authorUserId,
      occurredAt: new Date(options.occurred),
      recordedAt: options.recorded,
      occurrenceEnd: new Date(options.occurred),
      occurrencePrecision: "day",
      occurrenceOffsetMinutes: 0,
      visibility: "public",
      moderationState: "allowed",
      discoverable: true,
      ...options.over,
    };

    await timeline.project(row);
    await timeline.projectContexts(row, [
      { type: "person", id: row.authorUserId },
      ...(options.participants ?? []).map((id) => ({ type: "person" as const, id })),
      ...(options.locationId === undefined
        ? []
        : [{ type: "location" as const, id: options.locationId }]),
    ]);

    return row;
  };

  const ofPerson = (userId: string, over: Partial<ViewSpecification> = {}) =>
    ({
      derivationVersion: 1,
      context: { type: "person", id: userId },
      perspective: "all",
      filters: {},
      position: {},
      limit: 50,
      direction: "older",
      ...over,
    }) as ViewSpecification;

  describe("what counts as new", () => {
    it("counts a Moment recorded today and placed in 1969", async () => {
      // The property the whole feature exists for. Backfilling history into its
      // correct chronological position is the product, so the addition worth
      // telling somebody about is the one whose occurrence is oldest.
      const person = await onboard();
      await place({
        authorUserId: person.userId,
        occurred: "1969-07-20T00:00:00.000Z",
        recorded: new Date(),
      });

      const count = await service.deriveNewCount(
        person.userId,
        ofPerson(person.userId),
        LONG_AGO,
        CAP,
      );

      assert.equal(count, 1, "a Moment recorded today about 1969 was not new");
    });

    it("does not count history recorded before somebody last looked", async () => {
      const person = await onboard();
      await place({
        authorUserId: person.userId,
        occurred: "1969-07-20T00:00:00.000Z",
        recorded: new Date("2001-01-01T00:00:00.000Z"),
      });

      const count = await service.deriveNewCount(
        person.userId,
        ofPerson(person.userId),
        new Date("2002-01-01T00:00:00.000Z"),
        CAP,
      );

      assert.equal(count, 0);
    });

    it("does not count a Moment that merely moved", async () => {
      // Reprojection stamps a new `projected_at` — a visibility change, a
      // moderation decision, an accepted participation, a rebuild. Keying on it
      // would report a rebuilt decade as new to every reader at once, which is
      // the mistake the `recorded_at` column exists to prevent.
      const person = await onboard();
      const row = await place({
        authorUserId: person.userId,
        occurred: "1980-01-01T00:00:00.000Z",
        recorded: new Date("2001-01-01T00:00:00.000Z"),
      });

      await timeline.project(row);

      const count = await service.deriveNewCount(
        person.userId,
        ofPerson(person.userId),
        new Date("2002-01-01T00:00:00.000Z"),
        CAP,
      );

      assert.equal(count, 0, "reprojecting a Moment made it new again");
    });

    it("is new to nobody when it was projected before recording was kept", async () => {
      // Rows written before the column existed carry the epoch, which is below
      // every mark anybody could hold.
      const person = await onboard();
      await place({
        authorUserId: person.userId,
        occurred: "1975-01-01T00:00:00.000Z",
        recorded: new Date(0),
      });

      const count = await service.deriveNewCount(
        person.userId,
        ofPerson(person.userId),
        new Date(0),
        CAP,
      );

      assert.equal(count, 0);
    });

    it("stops at the ceiling rather than counting a whole history", async () => {
      const person = await onboard();
      const recorded = new Date();

      for (let index = 0; index < 5; index += 1) {
        await place({
          authorUserId: person.userId,
          occurred: `19${60 + index}-01-01T00:00:00.000Z`,
          recorded,
        });
      }

      const count = await service.deriveNewCount(person.userId, ofPerson(person.userId), LONG_AGO, 3);

      assert.equal(count, 3, "the cap did not bound the count");
    });
  });

  describe("what a view narrows to", () => {
    it("counts within the specification, not merely within the context", async () => {
      const person = await onboard();
      const recorded = new Date();

      await place({
        authorUserId: person.userId,
        occurred: "1969-07-20T00:00:00.000Z",
        recorded,
      });
      await place({
        authorUserId: person.userId,
        occurred: "1999-07-20T00:00:00.000Z",
        recorded,
      });

      const sixties = await service.deriveNewCount(
        person.userId,
        ofPerson(person.userId, {
          range: { kind: "fixed", from: "1960-01-01T00:00:00.000Z", to: "1969-12-31T00:00:00.000Z" },
        }),
        LONG_AGO,
        CAP,
      );

      assert.equal(sixties, 1, "the count ignored what the view narrows by");
    });

    it("resolves a rolling range against the sweep's clock, not the saving clock", async () => {
      // A view of "the last thirty days" expels history as it slides. A count
      // computed against a clock pinned to when it was saved would keep
      // promising Moments the view has since let go of.
      const person = await onboard();
      const recorded = new Date();
      const occurred = new Date();
      occurred.setUTCDate(occurred.getUTCDate() - 10);

      await place({
        authorUserId: person.userId,
        occurred: occurred.toISOString(),
        recorded,
      });

      const view = ofPerson(person.userId, { range: { kind: "rolling", unit: "day", count: 30 } });

      const today = await service.deriveNewCount(person.userId, view, LONG_AGO, CAP);

      const later = new Date();
      later.setUTCDate(later.getUTCDate() + 60);
      const inTwoMonths = await service.deriveNewCount(person.userId, view, LONG_AGO, CAP, later);

      assert.equal(today, 1, "a Moment inside the window was not counted");
      assert.equal(inTwoMonths, 0, "the window did not move with the clock");
    });
  });

  describe("what must not be counted", () => {
    it("leaves out a Moment a stranger may not read", async () => {
      const author = await onboard();
      const stranger = await onboard();
      const recorded = new Date();

      await place({
        authorUserId: author.userId,
        occurred: "1969-07-20T00:00:00.000Z",
        recorded,
      });
      await place({
        authorUserId: author.userId,
        occurred: "1969-07-21T00:00:00.000Z",
        recorded,
        over: { visibility: "private" },
      });

      const count = await service.deriveNewCount(
        stranger.userId,
        ofPerson(author.userId),
        LONG_AGO,
        CAP,
      );

      assert.equal(count, 1, "a private Moment was counted for somebody else");
    });

    it("leaves out a Moment withheld while it is under review", async () => {
      const author = await onboard();
      const stranger = await onboard();

      await place({
        authorUserId: author.userId,
        occurred: "1969-07-20T00:00:00.000Z",
        recorded: new Date(),
        over: { moderationState: "temporarily_unavailable" },
      });

      const count = await service.deriveNewCount(
        stranger.userId,
        ofPerson(author.userId),
        LONG_AGO,
        CAP,
      );

      assert.equal(count, 0);
    });

    it("leaves out age-restricted history for somebody too young for it", async () => {
      const author = await onboard();
      const child = await onboard(CHILD());

      await place({
        authorUserId: author.userId,
        occurred: "1969-07-20T00:00:00.000Z",
        recorded: new Date(),
        over: { moderationState: "age_restricted" },
      });

      const count = await service.deriveNewCount(
        child.userId,
        ofPerson(author.userId),
        LONG_AGO,
        CAP,
      );

      assert.equal(count, 0);
    });

    it("counts nothing at all in a Timeline that has been closed", async () => {
      // Deriving it answers empty, so a number over it would promise history
      // that opening cannot produce.
      const author = await onboard();
      const stranger = await onboard();

      await place({
        authorUserId: author.userId,
        occurred: "1969-07-20T00:00:00.000Z",
        recorded: new Date(),
      });

      await database.dataSource.query(
        `INSERT INTO user_preferences (user_id, timeline_is_public)
         VALUES ($1, false)
         ON CONFLICT (user_id) DO UPDATE SET timeline_is_public = false`,
        [author.userId],
      );

      const count = await service.deriveNewCount(
        stranger.userId,
        ofPerson(author.userId),
        LONG_AGO,
        CAP,
      );

      assert.equal(count, 0, "a closed Timeline still reported new history");
    });

    it("counts a Moment on your own Timeline you may not read", async () => {
      // The deliberate exception, and the only case that can tell a filtered own
      // count from an unfiltered one. A Moment somebody *authored* is admitted
      // by the eligibility rule anyway — its first clause is your own history,
      // whatever state it is in — so only a Moment they were named in, authored
      // by somebody else and shut, distinguishes the two.
      //
      // `ownSlice` returns it redacted and `ownBuckets` counts it: they accepted
      // being part of it, and their own history should not have a hole they
      // cannot see the shape of. This has to agree with both.
      const author = await onboard();
      const participant = await onboard();

      await place({
        authorUserId: author.userId,
        occurred: "1969-07-20T00:00:00.000Z",
        recorded: new Date(),
        participants: [participant.userId],
        over: { visibility: "private" },
      });

      const count = await service.deriveNewCount(
        participant.userId,
        ofPerson(participant.userId),
        LONG_AGO,
        CAP,
      );

      assert.equal(count, 1, "a Moment they were part of went missing from their own count");
    });
  });

  describe("the count and the page agree", () => {
    it("counts exactly what paging the view would return", async () => {
      // The strongest single assertion here. A badge is only worth anything if
      // opening the view produces what it promised.
      const author = await onboard();
      const reader = await onboard();
      const locationId = await createLocation(database.dataSource, author.userId);
      const mark = new Date("2010-01-01T00:00:00.000Z");
      const after = new Date("2011-01-01T00:00:00.000Z");

      await place({
        authorUserId: author.userId,
        occurred: "1969-07-20T00:00:00.000Z",
        recorded: after,
        locationId,
      });
      await place({
        authorUserId: author.userId,
        occurred: "1969-07-21T00:00:00.000Z",
        recorded: after,
        locationId,
        over: { visibility: "private" },
      });
      await place({
        authorUserId: author.userId,
        occurred: "1969-07-22T00:00:00.000Z",
        recorded: new Date("2005-01-01T00:00:00.000Z"),
        locationId,
      });

      const view = {
        derivationVersion: 1,
        context: { type: "location", id: locationId },
        perspective: "all",
        filters: {},
        position: {},
        limit: 50,
        direction: "older",
      } as ViewSpecification;

      const counted = await service.deriveNewCount(reader.userId, view, mark, CAP);
      const page = await service.derivePage(reader.userId, view);
      const readable = page.moments.filter((moment) => moment.readable).length;

      // Two of the three are this reader's to see; one of those two arrived
      // after the mark. So the badge is a strict subset of the page, chosen by
      // when history was recorded — and the private one is in neither.
      assert.equal(readable, 2, "the page did not hold what the fixture placed");
      assert.equal(counted, 1, "the count disagreed with the page it summarises");
      assert.ok(counted <= readable, "the count promised more than the view can produce");
    });
  });
});
