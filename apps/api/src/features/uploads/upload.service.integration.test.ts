import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, it } from "vitest";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { DerivativeClient } from "../../integrations/metadata/derivative-client.js";
import { createDerivativeClient } from "../../integrations/metadata/derivative-client.js";
import type { MetadataClient } from "../../integrations/metadata/metadata-client.js";
import { createMetadataClient } from "../../integrations/metadata/metadata-client.js";
import { createStorageClient, type StorageClient } from "../../integrations/storage/storage-client.js";
import { migrate } from "../../lib/database/migrations.js";
import { createDatabase, type Database } from "../../lib/database/postgres.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { systemContext } from "../../types/request-context.js";
import { UploadRepository } from "./upload.repository.js";
import { UploadService } from "./upload.service.js";

/**
 * Uploads, driven through the service against real infrastructure.
 *
 * The suites next door cover the ordinary paths: the HTTP surface, and the
 * media worker putting real files through a real decoder. What is here is what
 * neither reaches — an authorisation that lapsed while the bytes were in
 * flight, two checkers racing over one file, and the difference between a
 * decoder that is briefly unreachable and a file that will never decode.
 *
 * The decoder and the derivative tools are the one thing substituted, and only
 * where the test is about how a failure is classified rather than about
 * decoding. They are subprocess boundaries; PostgreSQL and object storage are
 * real throughout, because what is being tested is what they decide.
 *
 * Requires `pnpm infra:up` and ffprobe on PATH.
 */

const BUCKET = process.env.S3_BUCKET ?? "chronologity-media";

const storageConfig = {
  endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:8333",
  region: process.env.S3_REGION ?? "us-east-1",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "chronologity",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "chronologity-local-secret",
  bucket: BUCKET,
  forcePathStyle: true,
  uploadUrlTtlSeconds: 900,
};

const LIMITS = {
  registrationTtlSeconds: 3_600,
  maxImageBytes: 26_214_400,
  maxVideoBytes: 524_288_000,
};

const fixture = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));

/** A decoder that fails the same way every time, for classifying the failure. */
const failingMetadata = (error: Error): MetadataClient => ({
  probe: () => Promise.reject(error),
});

/** Derivative tools that fail the same way every time. */
const failingDerivatives = (error: Error): DerivativeClient => ({
  thumbnail: () => Promise.reject(error),
  poster: () => Promise.reject(error),
  faststart: () => Promise.reject(error),
});

const transientError = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
const permanentError = () => new Error("moov atom not found");

describe("uploads", () => {
  let database: Database;
  let storage: StorageClient;
  let repository: UploadRepository;
  let uploads: UploadService;
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

    const admin = new S3Client({
      endpoint: storageConfig.endpoint,
      region: storageConfig.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: storageConfig.accessKeyId,
        secretAccessKey: storageConfig.secretAccessKey,
      },
    });

    try {
      await admin.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (error) {
      const name = (error as { name?: string }).name;

      if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
        throw error;
      }
    }
    admin.destroy();

    storage = createStorageClient(storageConfig);
    repository = new UploadRepository(database.pool);
    uploads = build({ metadata: createMetadataClient(), derivatives: createDerivativeClient() });
  });

  afterAll(async () => {
    storage.close();
    await database.close();
  });

  /**
   * An Upload service sharing this suite's database, storage, and clock.
   *
   * @param tools - The decoder and derivative producers, or neither.
   * @returns The service.
   */
  function build(tools: { metadata?: MetadataClient; derivatives?: DerivativeClient } = {}) {
    return new UploadService(database.pool, repository, storage, LIMITS, {
      ...tools,
      clock: () => now,
    });
  }

  const context = () => systemContext(randomUUID(), new Date());

  /**
   * The operational columns, which the Upload a caller sees does not carry.
   *
   * How many times a file was opened, when it was last looked at, and whether
   * a refusal is worth retrying are the checker's business rather than the
   * uploader's, so they are read from the row.
   */
  const progressOf = async (uploadId: string) => {
    const { rows } = await database.pool.query<{
      attempts: number;
      checked_at: Date | null;
      failure_category: string | null;
      derivatives: string[] | null;
    }>(
      `SELECT attempts, checked_at, failure_category, derivatives
         FROM uploads WHERE upload_id = $1`,
      [uploadId],
    );

    const row = rows[0];
    assert.ok(row !== undefined, `no upload ${uploadId}`);

    return row;
  };

  /** How many arrivals have been enqueued for an upload. */
  const outboxRowsFor = async (uploadId: string): Promise<number> => {
    const { rows } = await database.pool.query<{ count: string }>(
      `SELECT count(*) FROM outbox_messages WHERE aggregate_id = $1`,
      [uploadId],
    );

    return Number(rows[0]?.count ?? "0");
  };

  /**
   * Wait until something is blocked writing to `uploads`.
   *
   * @returns Nothing, once a backend is waiting on the row.
   * @throws {Error} If nothing ever blocks, which means the collision the test
   *   depends on did not happen and its result would prove nothing.
   */
  const waitForUploadLock = async (): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await database.pool.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query ILIKE '%update uploads%'`,
      );

      if (rows.length > 0) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error("nothing ever blocked on the contested upload");
  };

  /** Authorise an upload and write the bytes, stopping short of finalizing. */
  const upload = async (file: string, declaredKind: "image" | "video") => {
    const ownerUserId = randomUUID();
    const contentType = declaredKind === "image" ? "image/jpeg" : "video/mp4";
    const bytes = await readFile(fixture(file));

    const authorization = await uploads.register(ownerUserId, {
      contentType,
      declaredByteSize: bytes.byteLength,
    });

    const put = await fetch(authorization.uploadUrl, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": contentType },
    });

    assert.equal(put.status, 200, "the presigned link did not accept the file");

    return { uploadId: authorization.uploadId, ownerUserId };
  };

  /** Authorise, write, and finalize: an upload waiting to be examined. */
  const arrive = async (file: string, declaredKind: "image" | "video") => {
    const written = await upload(file, declaredKind);
    await uploads.finalize(written.uploadId, written.ownerUserId, context());

    return written;
  };

  describe("finalizing", () => {
    it("refuses an authorisation that lapsed while the bytes were in flight", async () => {
      const { uploadId, ownerUserId } = await upload("photo.jpg", "image");
      const storageKey = (await repository.findRecord(uploadId))?.storageKey;
      assert.ok(storageKey !== undefined);

      // The presigned link and the registration expire independently, so an
      // object can be written under an authorisation that has since lapsed.
      now = new Date(Date.now() + (LIMITS.registrationTtlSeconds + 60) * 1000);

      await assert.rejects(
        uploads.finalize(uploadId, ownerUserId, context()),
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          assert.match(error.message, /authorisation expired/);
          return true;
        },
      );

      now = new Date();

      // Nothing will ever claim those bytes, so they must not be left behind to
      // be paid for.
      assert.equal(await storage.head(storageKey), undefined);
      assert.equal((await repository.findRecord(uploadId))?.status, "failed");
    });

    it("is idempotent when asked twice in a row", async () => {
      const { uploadId, ownerUserId } = await upload("photo.jpg", "image");

      await uploads.finalize(uploadId, ownerUserId, context());
      await uploads.finalize(uploadId, ownerUserId, context());

      // The caller asked for a state that already holds, which is not an error.
      // What must not happen is two arrivals announced for one file: the outbox
      // row is what sets the media pipeline going.
      assert.equal(await outboxRowsFor(uploadId), 1);
    });

    it("announces nothing when another finalize settled the upload first", async () => {
      const { uploadId, ownerUserId } = await upload("photo.jpg", "image");

      // Concurrent finalizes do not reliably collide: the later one tends to
      // read the upload after the earlier has committed and return early, so
      // the conditional update never has to settle anything. Here the
      // collision is arranged — the finalize below reads a registered upload,
      // and by the time its update runs the state has moved underneath it.
      const other = await database.pool.connect();

      try {
        await other.query("BEGIN");
        await other.query(
          `UPDATE uploads SET state = 'received', received_at = now() WHERE upload_id = $1`,
          [uploadId],
        );

        // Started, not awaited. Its read sees a registered upload because the
        // change above has not committed; its update then blocks on the row.
        const settling = uploads.finalize(uploadId, ownerUserId, context());

        await waitForUploadLock();
        await other.query("COMMIT");

        // Resolves rather than throwing: the other writer's answer stands, and
        // a finalize that lost is not an error.
        await settling;
      } finally {
        other.release();
      }

      assert.equal(
        await outboxRowsFor(uploadId),
        0,
        "an arrival was announced for a state this call did not establish",
      );
    });
  });

  describe("examining a file", () => {
    it("refuses to examine an upload that does not exist", async () => {
      await assert.rejects(uploads.check(randomUUID()), NotFoundError);
    });

    it("answers without looking again once a file is ready", async () => {
      const { uploadId } = await arrive("photo.jpg", "image");
      assert.equal(await uploads.check(uploadId), true);

      const before = await progressOf(uploadId);
      assert.equal(await uploads.check(uploadId), true);
      const after = await progressOf(uploadId);

      // A note redelivered after the work was done must cost nothing.
      assert.deepEqual(after.checked_at, before.checked_at);
      assert.equal(after.attempts, before.attempts);
    });

    it("answers without looking again once a file has been refused", async () => {
      const { uploadId } = await arrive("not-really-a-photo.jpg", "image");
      assert.equal(await uploads.check(uploadId), false);

      const before = await progressOf(uploadId);
      assert.equal(await uploads.check(uploadId), false);
      const after = await progressOf(uploadId);

      assert.equal(after.attempts, before.attempts);
    });

    it("refuses to examine anything in a process with no decoder", async () => {
      const { uploadId } = await arrive("photo.jpg", "image");

      // The HTTP process wires uploads without media tools on purpose: it
      // authorises and verifies uploads, and never opens one.
      await assert.rejects(build().check(uploadId), /cannot examine media/);
    });

    it("asks to be tried again when the decoder is briefly unreachable", async () => {
      const { uploadId } = await arrive("photo.jpg", "image");
      const unreachable = build({
        metadata: failingMetadata(transientError()),
        derivatives: createDerivativeClient(),
      });

      // Rethrown rather than settled: the queue redelivers, and the file is
      // still perfectly good.
      await assert.rejects(unreachable.check(uploadId), /socket hang up/);
      assert.equal((await repository.findRecord(uploadId))?.status, "received");
    });

    it("settles a file the decoder will never read, rather than retrying forever", async () => {
      const { uploadId } = await arrive("photo.jpg", "image");
      const broken = build({
        metadata: failingMetadata(permanentError()),
        derivatives: createDerivativeClient(),
      });

      assert.equal(await broken.check(uploadId), false);

      const record = await repository.findById(uploadId);
      assert.equal(record?.state, "failed");
      assert.equal((await progressOf(uploadId)).failure_category, "permanent");
    });

    it("counts an attempt before opening the file, not after", async () => {
      const { uploadId } = await arrive("photo.jpg", "image");
      const broken = build({
        metadata: failingMetadata(transientError()),
        derivatives: createDerivativeClient(),
      });

      await assert.rejects(broken.check(uploadId));
      const once = await progressOf(uploadId);

      await assert.rejects(broken.check(uploadId));
      const twice = await progressOf(uploadId);

      // A file that reliably kills the decoder must leave evidence it was
      // tried. Counting afterwards would let it be retried forever, each
      // attempt vanishing with the process.
      assert.ok(once.attempts >= 1);
      assert.ok(twice.attempts > once.attempts);
    });

    it("asks to be tried again when a derivative tool is briefly unreachable", async () => {
      const { uploadId } = await arrive("photo.jpg", "image");
      const unreachable = build({
        metadata: createMetadataClient(),
        derivatives: failingDerivatives(transientError()),
      });

      await assert.rejects(unreachable.check(uploadId), /socket hang up/);
      assert.equal((await repository.findRecord(uploadId))?.status, "received");
    });

    it("settles a file no derivative can be made from", async () => {
      const { uploadId } = await arrive("photo.jpg", "image");
      const broken = build({
        metadata: createMetadataClient(),
        derivatives: failingDerivatives(permanentError()),
      });

      assert.equal(await broken.check(uploadId), false);

      const record = await repository.findById(uploadId);
      assert.equal(record?.state, "failed");
      assert.equal((await progressOf(uploadId)).failure_category, "permanent");
    });

    it("keeps derivatives produced before an interrupted check", async () => {
      const { uploadId } = await arrive("photo.jpg", "image");

      // What a resumed check sees: the previous attempt produced everything
      // but did not get to record readiness. The union is seeded from the row,
      // so nothing is produced a second time.
      await database.pool.query(
        `UPDATE uploads SET derivatives = $2 WHERE upload_id = $1`,
        [uploadId, ["thumbnail"]],
      );

      const refusesToWork = build({
        metadata: createMetadataClient(),
        derivatives: failingDerivatives(permanentError()),
      });

      assert.equal(await refusesToWork.check(uploadId), true);

      assert.equal((await repository.findById(uploadId))?.state, "ready");
      assert.deepEqual((await progressOf(uploadId)).derivatives, ["thumbnail"]);
    });

    it("lets exactly one of two simultaneous checkers settle a file", async () => {
      const { uploadId } = await arrive("photo.jpg", "image");

      const [first, second] = await Promise.all([
        uploads.check(uploadId),
        uploads.check(uploadId),
      ]);

      // Both report the file good, because it is. The transition is a
      // conditional update, so only one of them actually moved it.
      assert.deepEqual([first, second], [true, true]);

      const record = await repository.findById(uploadId);
      assert.equal(record?.state, "ready");
    });
  });

  describe("reading", () => {
    it("refuses an upload belonging to somebody else exactly as one that does not exist", async () => {
      const { uploadId } = await arrive("photo.jpg", "image");

      await assert.rejects(uploads.get(uploadId, randomUUID()), NotFoundError);
      await assert.rejects(uploads.get(randomUUID(), randomUUID()), NotFoundError);
    });

    it("refuses a deleted upload", async () => {
      const { uploadId, ownerUserId } = await arrive("photo.jpg", "image");

      await uploads.delete(uploadId, ownerUserId);

      await assert.rejects(uploads.get(uploadId, ownerUserId), NotFoundError);
    });
  });
});
