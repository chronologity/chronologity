// Before anything that declares an entity: TypeORM's decorators register
// themselves through the metadata reflection API, which is a polyfill rather
// than something the runtime provides.
import "reflect-metadata";

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "../config/app-config.js";
import { connectDatabase, createDatabase } from "../lib/database/postgres.js";
import type { DataSource } from "typeorm";

const usage =
  "Usage: pnpm seed:history [--seed <int>] [--moments <int>] [--people <int>] [--views <int>]\n" +
  "                         [--places <int>] [--events <int>] [--comments <int>] [--replies-per <int>]\n" +
  "                         [--media-per <int>] [--participants <int>] [--blocks <int>] [--purge] [--force]";

/**
 * Generate a synthetic history to measure against.
 *
 *     pnpm seed:history --seed 1 --moments 50000
 *     pnpm timeline:rebuild --version bench
 *     pnpm seed:history --purge
 *
 * Phase 7 asks for scale validation against "non-trivial synthetic historical
 * datasets" covering dense and sparse periods. The numbers in ADR-132 were taken
 * against exactly such a dataset, built by hand and then lost — so nobody,
 * including its author, can reproduce them. This is that generator, committed.
 *
 * **Everything derives from `--seed`, including the identifiers.** ClickHouse
 * orders `moment_id` as a string and that ordering is part of the Timeline's
 * sort key, breaking ties between Moments that occurred at the same instant.
 * Random identifiers would therefore lay the projection out differently on every
 * run, and the second measurement would not be comparable with the first — which
 * is the whole reason to record a first one. `scripts/load.mjs` opens with the
 * same argument.
 *
 * **It writes PostgreSQL only.** ClickHouse is filled by `pnpm timeline:rebuild
 * --version <name>`, because the rebuild is part of what is being measured and a
 * generator writing the projection directly could disagree with the projector
 * and quietly invalidate the result. Use `--version`: rebuilding in place costs
 * a mutation per Moment, which is about six hours for fifty thousand.
 *
 * **It refuses to run anywhere but this machine.** Three guards, strongest
 * first: the host allowlist `scripts/reset-database.sh` and `scripts/load.mjs`
 * already share, a non-empty `moments` table without `--force`, and
 * `NODE_ENV=production`.
 */

/** Hosts this may write to. The same list `reset-database.sh` carries. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

/** Everything seeded carries this, so `--purge` can find all of it and nothing else. */
const HANDLE_PREFIX = "seed-";

/** How many rows go in one statement. */
const BATCH = 1_000;

/**
 * Fraction of Moments packed into a single dense month.
 *
 * A real history is not uniform: a wedding produces two hundred Moments in a day
 * and a decade of childhood produces forty. A generator that spread everything
 * evenly would measure a shape nobody has.
 */
const DENSE_SHARE = 0.6;

/**
 * A small deterministic generator.
 *
 * Mulberry32, five lines and no dependency — CLAUDE.md asks that a trivial
 * utility not become one.
 *
 * @param seed - Any integer.
 * @returns A function yielding the next number in [0, 1).
 */
function random(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Separate draw sequences, one per kind of thing.
 *
 * **Not one shared sequence.** The first recorded baseline is reproducible from
 * `--seed 1 --moments 50000`, and every Moment's occurrence comes from the shared
 * draw. Taking a draw for anything new — before the Moment loop, inside it, or
 * after it — shifts every later draw and silently changes a corpus somebody has
 * already measured against. Giving each kind its own stream keeps the Moments
 * identical whatever else is asked for, and survives a later kind being added.
 */
const STREAM = {
  places: 0x9e37,
  events: 0x85eb,
  comments: 0xc2b2,
  media: 0x27d4,
  participation: 0x1656,
  blocks: 0xd3a2,
} as const;

/**
 * A UUID derived from a seed and a label rather than from entropy.
 *
 * @param seed - The run's seed.
 * @param label - What this identifier names, unique within the run.
 * @returns A version-4-shaped UUID, the same for the same inputs forever.
 */
function identifier(seed: number, label: string): string {
  const digest = createHash("sha256").update(`${seed}:${label}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));

  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Refuse to write anywhere but this developer's machine.
 *
 * @param host - Where the database is.
 * @returns Nothing.
 * @throws {Error} If the host is not local, or the environment says production.
 */
function refuseAnywhereElse(host: string): void {
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to seed '${host}'. This generates local development data only.`);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed with NODE_ENV=production.");
  }
}

/** What one run produced, printed so a measurement can quote it. */
interface Seeded {
  readonly people: number;
  readonly moments: number;
  readonly views: number;
  readonly places: number;
  readonly events: number;
  readonly comments: number;
  readonly media: number;
  readonly participations: number;
  readonly blocks: number;
  readonly denseFrom: string;
  readonly denseTo: string;
  readonly sparseFrom: string;
  readonly sparseTo: string;
}

/**
 * Remove everything a seed run created, and nothing else.
 *
 * @param dataSource - The database.
 * @returns How many accounts went.
 * @throws {Error} If the database refuses.
 */
async function purge(dataSource: DataSource): Promise<number> {
  const rows: { user_id: string; identity_id: string }[] = await dataSource.query(
    `SELECT user_id, identity_id FROM users WHERE handle LIKE $1`,
    [`${HANDLE_PREFIX}%`],
  );

  const users = rows.map(({ user_id }) => user_id);

  if (users.length === 0) {
    return 0;
  }

  // **Every seeded Moment first, across all of them.** A place one account
  // recorded can be attached to a Moment another authored, so removing an
  // account's places while another account's Moments still point at them is
  // refused. Two passes rather than one loop: everything Moment-shaped goes,
  // then what those Moments referred to, then the accounts themselves.
  await dataSource.query(`DELETE FROM moments WHERE author_user_id = ANY($1::uuid[])`, [users]);
  await dataSource.query(`DELETE FROM locations WHERE recorded_by_user_id = ANY($1::uuid[])`, [users]);
  await dataSource.query(`DELETE FROM real_world_events WHERE created_by_user_id = ANY($1::uuid[])`, [users]);
  await dataSource.query(`DELETE FROM uploads WHERE owner_user_id = ANY($1::uuid[])`, [users]);
  await dataSource.query(
    `DELETE FROM user_blocks WHERE blocker_user_id = ANY($1::uuid[]) OR blocked_user_id = ANY($1::uuid[])`,
    [users],
  );

  for (const { user_id, identity_id } of rows) {
    await dataSource.query(`DELETE FROM saved_views WHERE user_id = $1`, [user_id]);
    await dataSource.query(`DELETE FROM user_handles WHERE user_id = $1`, [user_id]);
    await dataSource.query(`DELETE FROM user_restricted_data WHERE user_id = $1`, [user_id]);
    await dataSource.query(`DELETE FROM user_preferences WHERE user_id = $1`, [user_id]);
    await dataSource.query(`DELETE FROM users WHERE user_id = $1`, [user_id]);
    // **This account's Identity, not every orphaned one.** It previously deleted
    // any Identity no User pointed at, which reaches whatever else has left one
    // behind — and fails outright when one of those carries an email address,
    // because that foreign key refuses. A purge that claims to remove "what a
    // seed run created, and nothing else" must not decide by orphanhood.
    await dataSource.query(`DELETE FROM identities WHERE identity_id = $1`, [identity_id]);
  }

  return rows.length;
}

/** How much of each attached kind a run wrote. */
interface Attached {
  readonly places: number;
  readonly events: number;
  readonly comments: number;
  readonly media: number;
  readonly participations: number;
  readonly blocks: number;
}

/**
 * Insert rows in batches, building the placeholder list as it goes.
 *
 * @param dataSource - Where to write.
 * @param into - The table and column list, as SQL.
 * @param columns - How many columns each row carries.
 * @param rows - The values, one array per row.
 * @returns How many rows were written.
 */
async function insertMany(
  dataSource: DataSource,
  into: string,
  columns: number,
  rows: readonly unknown[][],
): Promise<number> {
  let written = 0;

  for (let start = 0; start < rows.length; start += BATCH) {
    const chunk = rows.slice(start, start + BATCH);
    const placeholders = chunk.map(
      (_row, index) =>
        `(${Array.from({ length: columns }, (_unused, column) => `$${index * columns + column + 1}`).join(", ")})`,
    );

    await dataSource.query(
      `INSERT INTO ${into} VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
      chunk.flat(),
    );
    written += chunk.length;
  }

  return written;
}

/**
 * Everything a Moment can have hanging off it.
 *
 * Separated from the Moments themselves because a measurement needs them and a
 * correctness test does not: without places there is no Location Timeline to
 * read, without comments there is no discussion to page, and without Blocks the
 * eligibility rule short-circuits on an empty list and measures a path nobody
 * is on. All of it defaults to nothing, so an existing corpus is unchanged.
 *
 * @param dataSource - Where to write.
 * @param options - The seed and how much of each kind to make.
 * @param people - The accounts that exist, in creation order.
 * @returns How many of each kind were written.
 * @throws {Error} If PostgreSQL refuses a statement.
 */
async function attach(
  dataSource: DataSource,
  options: {
    seed: number;
    moments: number;
    places: number;
    events: number;
    comments: number;
    repliesPer: number;
    mediaPer: number;
    participants: number;
    blocks: number;
  },
  people: readonly string[],
): Promise<Attached> {
  const momentId = (index: number): string => identifier(options.seed, `moment:${index}`);
  const counts = { places: 0, events: 0, comments: 0, media: 0, participations: 0, blocks: 0 };

  if (options.places > 0) {
    const draw = random(options.seed ^ STREAM.places);
    const places = Array.from({ length: options.places }, (_unused, index) =>
      identifier(options.seed, `place:${index}`),
    );

    counts.places = await insertMany(
      dataSource,
      "locations (location_id, recorded_by_user_id, name, latitude, longitude, precision, city, country, country_code, source, created_at)",
      11,
      places.map((locationId, index) => [
        locationId,
        people[index % people.length],
        `Seeded place ${index}`,
        51.5 + index / 1000,
        -0.12 - index / 1000,
        "exact",
        "London",
        "United Kingdom",
        "GB",
        "explicit-selection",
        new Date(),
      ]),
    );

    // Roughly half the Moments happened somewhere, so a Location Timeline is
    // worth reading and the disclosure gate has both cases to answer.
    const attached: unknown[][] = [];

    for (let index = 0; index < options.moments; index += 1) {
      if (draw() < 0.5) {
        attached.push([momentId(index), places[Math.floor(draw() * places.length)], "user-asserted"]);
      }
    }

    await insertMany(dataSource, "moment_locations (moment_id, location_id, origin)", 3, attached);
  }

  if (options.events > 0) {
    const draw = random(options.seed ^ STREAM.events);
    const events = Array.from({ length: options.events }, (_unused, index) =>
      identifier(options.seed, `event:${index}`),
    );

    counts.events = await insertMany(
      dataSource,
      "real_world_events (real_world_event_id, created_by_user_id, name, occurrence_start, occurrence_end, occurrence_precision)",
      6,
      events.map((realWorldEventId, index) => [
        realWorldEventId,
        people[index % people.length],
        `Seeded occasion ${index}`,
        new Date(Date.UTC(1994, 5, 1 + (index % 28))),
        new Date(Date.UTC(1994, 5, 1 + (index % 28), 23, 59)),
        "day",
      ]),
    );

    const attached: unknown[][] = [];

    for (let index = 0; index < options.moments; index += 1) {
      if (draw() < 0.3) {
        attached.push([momentId(index), events[Math.floor(draw() * events.length)], "user-asserted"]);
      }
    }

    await insertMany(
      dataSource,
      "moment_real_world_events (moment_id, real_world_event_id, origin)",
      3,
      attached,
    );
  }

  if (options.comments > 0) {
    const draw = random(options.seed ^ STREAM.comments);
    const rows: unknown[][] = [];
    // The first five hundred land on one Moment, so there is a discussion worth
    // paging. The rest spread wide, because what a count scans is the table
    // rather than the discussion.
    const busy = Math.min(500, options.comments);
    const spread = Math.max(1, Math.min(options.moments, 5_000));

    for (let index = 0; index < options.comments; index += 1) {
      const onMoment = index < busy ? 0 : (index - busy) % spread;
      const commentId = identifier(options.seed, `comment:${index}`);
      const at = new Date(Date.UTC(2026, 0, 1) + index * 1_000);

      rows.push([
        commentId,
        momentId(onMoment),
        people[Math.floor(draw() * people.length)],
        null,
        null,
        `Seeded comment ${index}`,
        at,
      ]);

      for (let reply = 0; reply < options.repliesPer; reply += 1) {
        rows.push([
          identifier(options.seed, `reply:${index}:${reply}`),
          momentId(onMoment),
          people[Math.floor(draw() * people.length)],
          commentId,
          commentId,
          `Seeded reply ${index}.${reply}`,
          new Date(at.getTime() + (reply + 1) * 100),
        ]);
      }
    }

    counts.comments = await insertMany(
      dataSource,
      "moment_comments (comment_id, moment_id, author_user_id, thread_comment_id, in_reply_to_comment_id, body, created_at)",
      7,
      rows,
    );
  }

  if (options.mediaPer > 0) {
    const uploads: unknown[][] = [];
    const attached: unknown[][] = [];
    const onMoments = Math.min(options.moments, 1_000);
    const now = new Date();
    const expires = new Date(now.getTime() + 86_400_000);

    for (let index = 0; index < onMoments; index += 1) {
      // One Moment carries far more than the rest, so paging media has
      // something to page.
      const many = index === 0 ? options.mediaPer * 10 : options.mediaPer;

      for (let position = 0; position < many; position += 1) {
        const uploadId = identifier(options.seed, `upload:${index}:${position}`);

        uploads.push([
          uploadId,
          people[index % people.length],
          "image",
          "image/jpeg",
          1_024,
          `seed/${uploadId}`,
          "ready",
          now,
          expires,
          "image",
          1_200,
          900,
        ]);
        attached.push([momentId(index), uploadId, position]);
      }
    }

    await insertMany(
      dataSource,
      "uploads (upload_id, owner_user_id, kind, declared_content_type, declared_byte_size, storage_key, state, registered_at, expires_at, media_kind, width, height)",
      12,
      uploads,
    );
    counts.media = await insertMany(
      dataSource,
      "moment_media (moment_id, upload_id, position)",
      3,
      attached,
    );
  }

  if (options.participants > 0) {
    const draw = random(options.seed ^ STREAM.participation);
    const rows: unknown[][] = [];

    for (let index = 0; index < Math.min(options.moments, options.participants); index += 1) {
      rows.push([
        identifier(options.seed, `participation:${index}`),
        momentId(index),
        // Anybody but the first account, whose Timeline the measurement reads:
        // a Moment they took part in is on their Timeline too, and the point of
        // these is that `ALL` and `AUTHORED` differ.
        people[1 + Math.floor(draw() * (people.length - 1))],
        "accepted",
        // An accepted participation has been resolved, and the table refuses one
        // that says otherwise.
        new Date(),
      ]);
    }

    counts.participations = await insertMany(
      dataSource,
      "moment_participations (participation_id, moment_id, user_id, status, resolved_at)",
      5,
      rows,
    );
  }

  if (options.blocks > 0) {
    // All of them touch the first account, because that is whose Timeline a
    // measurement reads. An empty `blocked` list short-circuits inside the
    // eligibility rule, so a run without these measures a path nobody is on.
    const measured = people[0];

    counts.blocks = await insertMany(
      dataSource,
      "user_blocks (blocker_user_id, blocked_user_id)",
      2,
      Array.from({ length: Math.min(options.blocks, people.length - 1) }, (_unused, index) => [
        measured,
        people[index + 1],
      ]),
    );
  }

  return counts;
}

/**
 * Write a synthetic history.
 *
 * Raw batched SQL rather than the repositories: going through those would drag
 * in outbox rows, notification generation and search indexing, none of which a
 * Timeline measurement needs and all of which multiply the time.
 *
 * @param dataSource - The database.
 * @param options - How much of what, and from which seed.
 * @returns What was written, including the exact period boundaries so a
 *   measurement is reproducible from the seed alone.
 * @throws {Error} If the database refuses.
 */
async function seed(
  dataSource: DataSource,
  options: {
    seed: number;
    moments: number;
    people: number;
    views: number;
    places: number;
    events: number;
    comments: number;
    repliesPer: number;
    mediaPer: number;
    participants: number;
    blocks: number;
  },
): Promise<Seeded> {
  const next = random(options.seed);
  const people: string[] = [];

  for (let index = 0; index < options.people; index += 1) {
    const userId = identifier(options.seed, `user:${index}`);
    const identityId = identifier(options.seed, `identity:${index}`);
    const handle = `${HANDLE_PREFIX}${options.seed}-${index}`;

    // An Identity and nothing attached: no address, no password, no Session.
    // Seeded accounts are never signed in as, so giving them an address would
    // create something a stray sign-in mail could reach. Having none at all is
    // stronger than having an unroutable one.
    await dataSource.query(
      `INSERT INTO identities (identity_id, created_at) VALUES ($1, now())
       ON CONFLICT DO NOTHING`,
      [identityId],
    );
    await dataSource.query(
      `INSERT INTO users (user_id, identity_id, handle, display_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Seeded Person', 'active', now(), now()) ON CONFLICT DO NOTHING`,
      [userId, identityId, handle],
    );
    await dataSource.query(
      `INSERT INTO user_handles (normalized_handle, handle, user_id, assigned_at)
       VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING`,
      [handle, handle, userId],
    );

    people.push(userId);
  }

  // Dense: one month everybody was somewhere together. Sparse: forty years of
  // ordinary life. Both always produced, so a measurement can name either.
  const denseFrom = new Date("1994-06-01T00:00:00.000Z");
  const denseTo = new Date("1994-06-30T23:59:59.000Z");
  const sparseFrom = new Date("1960-01-01T00:00:00.000Z");
  const sparseTo = new Date("2000-01-01T00:00:00.000Z");
  const denseCount = Math.floor(options.moments * DENSE_SHARE);

  // Recording time is drawn independently of occurrence. If every Moment were
  // recorded now, every Moment would be new to every view and the measurement
  // would mean nothing; backfill — old occurrence, recent recording — is the
  // case worth measuring.
  const recordedSpanMs = 90 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  let written = 0;
  let batch: unknown[] = [];
  let placeholders: string[] = [];

  const flush = async (): Promise<void> => {
    if (placeholders.length === 0) {
      return;
    }

    await dataSource.query(
      `INSERT INTO moments
         (moment_id, author_user_id, caption, occurrence_start, occurrence_end,
          occurrence_precision, occurrence_offset_minutes, visibility, created_at, updated_at)
       VALUES ${placeholders.join(", ")}`,
      batch,
    );

    batch = [];
    placeholders = [];
  };

  for (let index = 0; index < options.moments; index += 1) {
    const dense = index < denseCount;
    const from = dense ? denseFrom.getTime() : sparseFrom.getTime();
    const to = dense ? denseTo.getTime() : sparseTo.getTime();
    const occurred = new Date(from + next() * (to - from));
    const recorded = new Date(now - next() * recordedSpanMs);
    const author = people[Math.floor(next() * people.length)]!;
    // A fifth private, so eligibility has something to withhold.
    const visibility = next() < 0.2 ? "private" : "public";
    const at = batch.length;

    placeholders.push(
      `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}, 'day', 0, $${at + 6}, $${at + 7}, $${at + 7})`,
    );
    batch.push(
      identifier(options.seed, `moment:${index}`),
      author,
      `Seeded moment ${index}`,
      occurred,
      occurred,
      visibility,
      recorded,
    );
    written += 1;

    if (placeholders.length >= BATCH) {
      await flush();
    }
  }

  await flush();

  for (let index = 0; index < options.views; index += 1) {
    const owner = people[index % people.length]!;
    const savedViewId = identifier(options.seed, `view:${index}`);

    await dataSource.query(
      `INSERT INTO saved_views (saved_view_id, user_id, title, specification, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now(), now()) ON CONFLICT DO NOTHING`,
      [
        savedViewId,
        owner,
        `Seeded view ${index}`,
        JSON.stringify({ context: { type: "person", id: people[(index + 1) % people.length] } }),
      ],
    );
    await dataSource.query(
      `INSERT INTO saved_view_awareness (saved_view_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [savedViewId],
    );
  }

  // After the Moments, and drawing from streams of their own, so asking for any
  // of it leaves the Moments byte-identical to a run that asked for none.
  const attached = await attach(dataSource, { ...options, moments: written }, people);

  return {
    people: people.length,
    moments: written,
    views: options.views,
    ...attached,
    denseFrom: denseFrom.toISOString(),
    denseTo: denseTo.toISOString(),
    sparseFrom: sparseFrom.toISOString(),
    sparseTo: sparseTo.toISOString(),
  };
}

/**
 * Load the repository's `.env`, as the shell scripts beside this one do.
 *
 * Without it the documented invocation only works for a caller who has already
 * sourced it, which is a reproducibility gap in a command whose whole purpose is
 * that somebody else can reproduce a measurement. Existing variables win where
 * one is already set.
 *
 * @returns Nothing.
 */
function loadEnvironment(): void {
  const envFile = fileURLToPath(new URL("../../../../.env", import.meta.url));

  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

/**
 * Run the command.
 *
 * @returns Nothing.
 * @throws {Error} If the arguments are wrong, the target is not local, or the
 *   database already holds history and `--force` was not given.
 */
async function main(): Promise<void> {
  loadEnvironment();

  const { values } = parseArgs({
    options: {
      seed: { type: "string", default: "1" },
      moments: { type: "string", default: "50000" },
      people: { type: "string", default: "100" },
      views: { type: "string", default: "10" },
      places: { type: "string", default: "0" },
      events: { type: "string", default: "0" },
      comments: { type: "string", default: "0" },
      "replies-per": { type: "string", default: "0" },
      "media-per": { type: "string", default: "0" },
      participants: { type: "string", default: "0" },
      blocks: { type: "string", default: "0" },
      purge: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
  });

  const config = loadConfig();

  refuseAnywhereElse(config.database.host);

  const database = createDatabase(config.database);

  await connectDatabase(database);

  try {
    if (values.purge) {
      const removed = await purge(database.dataSource);

      process.stdout.write(`Removed ${removed} seeded account(s) and everything they held\n`);

      return;
    }

    const counted: { count: string }[] = await database.dataSource.query(
      `SELECT COUNT(*) AS count FROM moments`,
    );
    const count = counted[0]?.count ?? "0";

    // A production database is far likelier to be non-empty than empty, so this
    // is a real second net rather than a restatement of the host check.
    if (Number(count) > 0 && !values.force) {
      throw new Error(
        `Refusing to seed: ${count} Moment(s) already exist. Use --purge, or --force to add anyway.`,
      );
    }

    const written = await seed(database.dataSource, {
      seed: Number(values.seed),
      moments: Number(values.moments),
      people: Number(values.people),
      views: Number(values.views),
      places: Number(values.places),
      events: Number(values.events),
      comments: Number(values.comments),
      repliesPer: Number(values["replies-per"]),
      mediaPer: Number(values["media-per"]),
      participants: Number(values.participants),
      blocks: Number(values.blocks),
    });

    process.stdout.write(
      `Seeded ${written.moments} Moments across ${written.people} people and ${written.views} views\n` +
        `  attached: ${written.places} places, ${written.events} occasions, ${written.comments} comments, ` +
        `${written.media} media, ${written.participations} participations, ${written.blocks} blocks\n` +
        `  dense:  ${written.denseFrom} .. ${written.denseTo}\n` +
        `  sparse: ${written.sparseFrom} .. ${written.sparseTo}\n` +
        `Now fill the projection: pnpm timeline:rebuild --version bench\n`,
    );
  } finally {
    await database.close();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`${String(error instanceof Error ? error.message : error)}\n${usage}\n`);
  }
  process.exit(1);
}
