import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { migrate } from "../../lib/database/migrations.js";
import { createDatabase, type Database } from "../../lib/database/postgres.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { UserRepository } from "./user.repository.js";
import { UserService } from "./user.service.js";

/**
 * Accounts, driven through the service against real infrastructure.
 *
 * The suite next door drives the same service through HTTP, and this one does
 * not repeat it. What is here is what the HTTP surface cannot reach: rules the
 * request schema refuses before a handler runs, and the races the database
 * settles — two people reaching for one handle at the same moment cannot be
 * arranged from two HTTP requests, because nothing makes them interleave.
 *
 * PostgreSQL is not substituted. The rules being tested are conditional writes,
 * and a stand-in would have to reimplement the semantics under test in order to
 * answer at all.
 *
 * Requires `pnpm infra:up`.
 */

const COOLDOWN_DAYS = 30;

/** Unique across the whole database, including earlier runs. */
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

const DAY_MS = 24 * 60 * 60 * 1000;

describe("accounts", () => {
  let database: Database;
  let users: UserService;
  let now = new Date();

  beforeAll(async () => {
    database = createDatabase({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      database: process.env.POSTGRES_DATABASE ?? "chronologity",
      user: process.env.POSTGRES_USER ?? "chronologity",
      password: process.env.POSTGRES_PASSWORD ?? "chronologity",
    });
    await migrate(database.pool);

    users = new UserService(database.pool, new UserRepository(database.pool), {
      minimumAgeYears: 13,
      handleCooldownDays: COOLDOWN_DAYS,
      clock: () => now,
    });
  });

  afterAll(async () => {
    await database.close();
  });

  /** An account, with the identity it belongs to and the handle it holds. */
  const account = async (handle = uniqueHandle()) => {
    const identityId = randomUUID();
    const userId = await users.create(identityId, {
      handle,
      displayName: "A Person",
      dateOfBirth: "1990-01-01",
    });

    return { identityId, userId, handle };
  };

  describe("creating", () => {
    it("refuses a second account for one identity", async () => {
      const { identityId } = await account();

      await assert.rejects(
        users.create(identityId, {
          handle: uniqueHandle(),
          displayName: "The Same Person",
          dateOfBirth: "1990-01-01",
        }),
        ValidationError,
      );
    });

    it("refuses a handle another account already holds", async () => {
      const { handle } = await account();

      await assert.rejects(
        users.create(randomUUID(), {
          handle,
          displayName: "Someone Else",
          dateOfBirth: "1990-01-01",
        }),
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          // "Reserved" and "held" read identically: which one it is maps out
          // the reserved list.
          assert.match(error.message, /not available/);
          return true;
        },
      );
    });

    it("refuses someone below the minimum age without stating the threshold", async () => {
      now = new Date("2026-08-19T00:00:00.000Z");

      await assert.rejects(
        users.create(randomUUID(), {
          handle: uniqueHandle(),
          displayName: "Too Young",
          dateOfBirth: "2020-01-01",
        }),
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          // An age gate that answers its own question only teaches people what
          // to type instead.
          assert.doesNotMatch(error.message, /13/);
          return true;
        },
      );

      now = new Date();
    });

    it("leaves no trace of an account refused for age", async () => {
      now = new Date("2026-08-19T00:00:00.000Z");
      const handle = uniqueHandle();

      await assert.rejects(
        users.create(randomUUID(), {
          handle,
          displayName: "Too Young",
          dateOfBirth: "2020-01-01",
        }),
        ValidationError,
      );

      // Checked before the handle and before anything is written: someone below
      // the minimum should leave nothing behind but the audit of the attempt.
      const { rows } = await database.pool.query(
        `SELECT 1 FROM user_handles WHERE normalized_handle = $1`,
        [handle.toLowerCase()],
      );
      assert.equal(rows.length, 0);

      now = new Date();
    });

    it("applies the default minimum age when none is configured", async () => {
      // Every other test configures one. Nothing in the process is obliged to,
      // and an unconfigured age gate that admits everyone would be worse than
      // no gate at all, because it would look like one.
      const unconfigured = new UserService(database.pool, new UserRepository(database.pool));

      await assert.rejects(
        unconfigured.create(randomUUID(), {
          handle: uniqueHandle(),
          displayName: "Too Young",
          dateOfBirth: new Date(Date.now() - 12 * 365.25 * DAY_MS).toISOString().slice(0, 10),
        }),
        ValidationError,
      );

      await assert.doesNotReject(
        unconfigured.create(randomUUID(), {
          handle: uniqueHandle(),
          displayName: "Old Enough",
          dateOfBirth: "1990-01-01",
        }),
      );
    });

    it("refuses a malformed handle", async () => {
      await assert.rejects(
        users.create(randomUUID(), {
          handle: "not a handle!",
          displayName: "A Person",
          dateOfBirth: "1990-01-01",
        }),
        ValidationError,
      );
    });

    it("lets exactly one of eight simultaneous claims take a handle", async () => {
      // The read that finds a handle free and the write that takes it are two
      // moments. Eight at once rather than two: with two, both can finish
      // reading before either writes, and the conditional insert that settles
      // it never runs.
      const handle = uniqueHandle();

      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          users.create(randomUUID(), {
            handle,
            displayName: "A Contender",
            dateOfBirth: "1990-01-01",
          }),
        ),
      );

      const won = attempts.filter((attempt) => attempt.status === "fulfilled");
      assert.equal(won.length, 1, "a handle went to more than one account");

      for (const lost of attempts.filter((attempt) => attempt.status === "rejected")) {
        assert.ok((lost as PromiseRejectedResult).reason instanceof ValidationError);
      }

      const { rows } = await database.pool.query<{ count: string }>(
        `SELECT count(*) FROM user_handles WHERE normalized_handle = $1`,
        [handle.toLowerCase()],
      );
      assert.equal(rows[0]?.count, "1");
    });
  });

  describe("claiming a handle across two open transactions", () => {
    it("gives it to whoever commits first, and tells the other it is taken", async () => {
      // The only way to reach the conditional insert inside `claimHandle`: both
      // transactions must find the handle free before either commits. Eight
      // concurrent callers do not reliably produce that — the losers' reads
      // tend to land after the winner has committed, and they are turned away
      // by the read instead. Here the interleaving is arranged rather than
      // hoped for.
      const handle = uniqueHandle();
      const repository = new UserRepository(database.pool);
      const winner = await database.pool.connect();
      const loser = await database.pool.connect();

      const claim = (userId: string) => ({
        handle,
        normalizedHandle: handle.toLowerCase(),
        userId,
        now: new Date(),
        cooldownDays: COOLDOWN_DAYS,
      });

      try {
        await winner.query("BEGIN");
        await loser.query("BEGIN");

        const { rows } = await loser.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        const loserPid = rows[0]?.pid;
        assert.ok(loserPid !== undefined);

        assert.deepEqual(await repository.claimHandle(winner, claim(randomUUID())), { ok: true });

        // Started, not awaited: its read finds the handle free, and its insert
        // then blocks on the index entry the uncommitted claim holds.
        const contested = repository.claimHandle(loser, claim(randomUUID()));

        await waitForLock(loserPid);
        await winner.query("COMMIT");

        assert.deepEqual(await contested, { ok: false, reason: "taken" });
        await loser.query("COMMIT");
      } finally {
        winner.release();
        loser.release();
      }

      const { rows } = await database.pool.query<{ count: string }>(
        `SELECT count(*) FROM user_handles WHERE normalized_handle = $1`,
        [handle.toLowerCase()],
      );
      assert.equal(rows[0]?.count, "1");
    });
  });

  describe("changing a profile", () => {
    it("refuses a change that changes nothing", async () => {
      const { userId } = await account();

      // The request schema requires a field to be present, not that it differs
      // from what is stored, so this is the service's own guard and only
      // reachable from here.
      await assert.rejects(
        users.updateProfile(userId, { displayName: "A Person" }),
        ValidationError,
      );
    });

    it("refuses an account that does not exist", async () => {
      await assert.rejects(
        users.updateProfile(randomUUID(), { displayName: "Nobody" }),
        NotFoundError,
      );
    });

    it("refuses a deactivated account", async () => {
      const { userId } = await account();
      await users.deactivate(userId);

      await assert.rejects(
        users.updateProfile(userId, { displayName: "Still Here" }),
        ValidationError,
      );
    });

    it("clears a biography with null and leaves it alone when absent", async () => {
      const { userId } = await account();

      await users.updateProfile(userId, { biography: "Something about me" });
      assert.equal((await users.getAccount(userId)).biography, "Something about me");

      await users.updateProfile(userId, { displayName: "A Renamed Person" });
      assert.equal(
        (await users.getAccount(userId)).biography,
        "Something about me",
        "an absent biography must leave it alone",
      );

      await users.updateProfile(userId, { biography: null });
      assert.equal((await users.getAccount(userId)).biography, null);
    });
  });

  describe("changing a handle", () => {
    it("refuses a malformed handle", async () => {
      const { userId } = await account();

      await assert.rejects(users.updateHandle(userId, "not a handle!"), ValidationError);
    });

    it("refuses the handle already held", async () => {
      const { userId, handle } = await account();

      await assert.rejects(users.updateHandle(userId, handle), (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.match(error.message, /already your handle/);
        return true;
      });
    });

    it("refuses one somebody else holds", async () => {
      const { userId } = await account();
      const other = await account();

      await assert.rejects(users.updateHandle(userId, other.handle), ValidationError);
    });

    it("refuses a deactivated account", async () => {
      const { userId } = await account();
      await users.deactivate(userId);

      await assert.rejects(users.updateHandle(userId, uniqueHandle()), ValidationError);
    });

    it("keeps a released handle reserved against everyone but its previous holder", async () => {
      const first = await account();
      await users.updateHandle(first.userId, uniqueHandle());

      // Handing a recognisable handle straight to someone else invites
      // impersonation, so it goes into cooldown rather than becoming free.
      const second = await account();
      await assert.rejects(users.updateHandle(second.userId, first.handle), ValidationError);

      // Its previous holder may take it back at any point during the cooldown.
      await users.updateHandle(first.userId, first.handle);
      assert.equal((await users.getAccount(first.userId)).handle, first.handle);
    });

    it("frees a released handle once the cooldown has passed", async () => {
      now = new Date("2026-08-19T00:00:00.000Z");

      const first = await account();
      await users.updateHandle(first.userId, uniqueHandle());

      const second = await account();
      await assert.rejects(users.updateHandle(second.userId, first.handle), ValidationError);

      now = new Date(now.getTime() + (COOLDOWN_DAYS + 1) * DAY_MS);

      await users.updateHandle(second.userId, first.handle);
      assert.equal((await users.getAccount(second.userId)).handle, first.handle);

      now = new Date();
    });

    it("lets someone restyle the capitalisation of the handle they hold", async () => {
      const { userId, handle } = await account();

      // Nothing else can be affected: the normalised form is unchanged, so no
      // reservation and no other account is involved. The claim used to find
      // an unreleased row and call it taken without noticing whose it was,
      // which told the holder their own handle was unavailable.
      await users.updateHandle(userId, handle.toUpperCase());

      assert.equal((await users.getAccount(userId)).handle, handle.toUpperCase());
      assert.equal(
        (await users.getByHandle(handle)).handle,
        handle.toUpperCase(),
        "the handle must still resolve in any casing",
      );
    });

    it("treats a restyle as presentation rather than taking the handle again", async () => {
      const { userId, handle } = await account();

      const before = await database.pool.query<{ assigned_at: Date }>(
        `SELECT assigned_at FROM user_handles WHERE normalized_handle = $1`,
        [handle.toLowerCase()],
      );

      await users.updateHandle(userId, handle.toUpperCase());

      const after = await database.pool.query<{ assigned_at: Date; released_at: Date | null }>(
        `SELECT assigned_at, released_at FROM user_handles WHERE normalized_handle = $1`,
        [handle.toLowerCase()],
      );

      // The moment it was acquired stands: it was not acquired again. Moving it
      // would restart a cooldown measured from the wrong instant.
      assert.deepEqual(after.rows[0]?.assigned_at, before.rows[0]?.assigned_at);
      assert.equal(after.rows[0]?.released_at, null);

      // And no second row: a restyle must not leave the old casing behind as a
      // released handle nobody can claim.
      const { rows } = await database.pool.query<{ count: string }>(
        `SELECT count(*) FROM user_handles WHERE user_id = $1`,
        [userId],
      );
      assert.equal(rows[0]?.count, "1");
    });

    it("still refuses a restyle of a handle somebody else holds", async () => {
      const { userId } = await account();
      const other = await account();

      // The holder check must distinguish "mine" from "unreleased", not
      // weaken the rule that an unreleased handle belongs to whoever has it.
      await assert.rejects(
        users.updateHandle(userId, other.handle.toUpperCase()),
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          assert.match(error.message, /not available/);
          return true;
        },
      );

      assert.equal((await users.getAccount(other.userId)).handle, other.handle);
    });

    it("never leaves an account holding two handles or none", async () => {
      const { userId, handle } = await account();
      const replacement = uniqueHandle();

      await users.updateHandle(userId, replacement);

      const { rows } = await database.pool.query<{ normalized_handle: string }>(
        `SELECT normalized_handle FROM user_handles
          WHERE user_id = $1 AND released_at IS NULL`,
        [userId],
      );

      assert.deepEqual(
        rows.map((row) => row.normalized_handle),
        [replacement.toLowerCase()],
      );
      assert.notEqual(replacement.toLowerCase(), handle.toLowerCase());
    });
  });

  describe("changing preferences", () => {
    it("refuses an account that does not exist", async () => {
      await assert.rejects(
        users.updatePreferences(randomUUID(), { autoplayVideos: false }),
        NotFoundError,
      );
    });

    it("leaves the preferences it was not asked about alone", async () => {
      const { userId } = await account();
      const before = (await users.getAccount(userId)).preferences;

      await users.updatePreferences(userId, { reducedMotion: !before.reducedMotion });
      const after = (await users.getAccount(userId)).preferences;

      assert.equal(after.reducedMotion, !before.reducedMotion);
      assert.equal(after.autoplayVideos, before.autoplayVideos);
      assert.equal(after.autoplaySound, before.autoplaySound);
      assert.equal(after.locale, before.locale);
      assert.equal(after.timeZone, before.timeZone);
    });
  });

  describe("deactivating and reactivating", () => {
    it("refuses to deactivate an account that does not exist", async () => {
      await assert.rejects(users.deactivate(randomUUID()), NotFoundError);
    });

    it("refuses to deactivate an account that is already deactivated", async () => {
      const { userId } = await account();
      await users.deactivate(userId);

      await assert.rejects(users.deactivate(userId), ValidationError);
    });

    it("refuses to reactivate an account that does not exist", async () => {
      await assert.rejects(users.reactivate(randomUUID()), NotFoundError);
    });

    it("refuses to reactivate an account that is already active", async () => {
      const { userId } = await account();

      await assert.rejects(users.reactivate(userId), ValidationError);
    });

    it("lets exactly one of two simultaneous deactivations through", async () => {
      const { userId } = await account();

      const attempts = await Promise.allSettled([
        users.deactivate(userId),
        users.deactivate(userId),
      ]);

      // The transition is a conditional update, so the second matches no rows
      // rather than recording a second deactivation.
      assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    });

    it("brings a deactivated account back", async () => {
      const { userId } = await account();

      await users.deactivate(userId);
      await users.reactivate(userId);

      assert.equal((await users.getAccount(userId)).status, "active");
    });
  });

  describe("reading", () => {
    it("refuses to read an account that does not exist", async () => {
      await assert.rejects(users.getAccount(randomUUID()), NotFoundError);
    });

    it("refuses to read a handle nobody holds", async () => {
      await assert.rejects(users.getByHandle(uniqueHandle()), NotFoundError);
    });

    it("refuses a former handle rather than pointing at who used to hold it", async () => {
      const { userId, handle } = await account();
      await users.updateHandle(userId, uniqueHandle());

      await assert.rejects(users.getByHandle(handle), NotFoundError);
    });

    it("hides a deactivated account from the public view", async () => {
      const { userId, handle } = await account();
      await users.deactivate(userId);

      await assert.rejects(users.getByHandle(handle), NotFoundError);

      // Its owner still sees it, because they need to in order to bring it back.
      assert.equal((await users.getAccount(userId)).status, "deactivated");
    });

    it("returns nothing for an identity that has not created an account", async () => {
      assert.equal(await users.findIdForIdentity(randomUUID()), undefined);
    });

    it("fails loudly for an account whose restricted data has gone", async () => {
      const { userId } = await account();

      // A targeted delete is what erasure of restricted data looks like: it
      // lives in its own table so that it can be removed without touching the
      // profile. An account in that state is not a profile with a missing
      // optional field, and answering with a plausible blank would hide it.
      await database.pool.query(`DELETE FROM user_restricted_data WHERE user_id = $1`, [userId]);

      await assert.rejects(users.getAccount(userId), /No restricted data recorded/);
    });
  });

  /**
   * Wait until a backend is blocked on a lock.
   *
   * @param pid - The backend to watch.
   * @returns Nothing, once it is waiting.
   * @throws {Error} If it never blocks, which means the interleaving the test
   *   depends on did not happen and the result would prove nothing.
   */
  async function waitForLock(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await database.pool.query(
        `SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'`,
        [pid],
      );

      if (rows.length > 0) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Backend ${pid} never blocked on the contested handle`);
  }
});
