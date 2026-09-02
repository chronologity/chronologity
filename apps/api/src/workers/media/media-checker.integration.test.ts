import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, it } from "vitest";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { UploadReceivedPayload } from "@chronologity/contracts";
import { UploadRepository } from "../../features/uploads/upload.repository.js";
import { UploadService } from "../../features/uploads/upload.service.js";
import { createDerivativeClient } from "../../integrations/metadata/derivative-client.js";
import { createMetadataClient } from "../../integrations/metadata/metadata-client.js";
import {
  createStorageClient,
  type StorageClient,
} from "../../integrations/storage/storage-client.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import { createUser } from "../../testing/fixtures.js";
import { systemContext } from "../../types/request-context.js";
import { deliverThroughBroker } from "../../testing/broker.js";
import { checkArrivedMedia, MEDIA_CHECKER_BOUNDARIES } from "./check-media.js";

/**
 * Opening real files, end to end.
 *
 * Every file here is a real one, uploaded to real storage through a real
 * presigned link and opened by a real decoder. Stubbing any of that would
 * reduce these to a test of my own assumptions — and the assumption that a
 * photograph does not look like a very short video was wrong, which only a
 * real JPEG revealed.
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

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../features/uploads/__fixtures__/${name}`, import.meta.url));

describe("checking media", () => {
  let database: Database;
  let uploads: UploadService;
  let repository: UploadRepository;
  let storage: StorageClient;

  beforeAll(async () => {
    database = createDatabase({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      database: process.env.POSTGRES_DATABASE ?? "chronologity",
      user: process.env.POSTGRES_USER ?? "chronologity",
      password: process.env.POSTGRES_PASSWORD ?? "chronologity",
    });
    await connectDatabase(database);
    await migrate(database.dataSource);

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
    repository = new UploadRepository(database.dataSource);
    uploads = new UploadService(
      database.dataSource,
      repository,
      storage,
      {
        registrationTtlSeconds: 3_600,
        maxImageBytes: 26_214_400,
        maxVideoBytes: 524_288_000,
      },
      { metadata: createMetadataClient(), derivatives: createDerivativeClient() },
    );
  });

  afterAll(async () => {
    storage.close();
    await database.close();
  });

  const context = () => systemContext(randomUUID(), new Date());

  /**
   * Put a real file through the whole path: authorised, uploaded, arrived.
   * Stops short of checking, which is what each test then exercises.
   */
  const arrive = async (file: string, declaredKind: "image" | "video") => {
    const { userId: ownerUserId } = await createUser(database.dataSource);
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

    await uploads.finalize(authorization.uploadId, ownerUserId, context());

    return { uploadId: authorization.uploadId, ownerUserId };
  };

  it("accepts a photograph, and records what it measured", async () => {
    const { uploadId } = await arrive("photo.jpg", "image");

    const accepted = await uploads.check(uploadId);

    assert.equal(accepted, true);

    const upload = await repository.findById(uploadId);

    assert.equal(upload?.state, "ready");
    assert.equal(upload?.mediaKind, "image");
    assert.equal(upload?.width, 640);
    assert.equal(upload?.height, 480);
    // A photograph has no length, and must not be given a fabricated one.
    assert.equal(upload?.durationSeconds, null);
  });

  it("accepts a video, and records its real length", async () => {
    const { uploadId } = await arrive("video-short.mp4", "video");

    assert.equal(await uploads.check(uploadId), true);

    const upload = await repository.findById(uploadId);

    assert.equal(upload?.state, "ready");
    assert.equal(upload?.mediaKind, "video");
    assert.ok(upload?.durationSeconds !== null && upload?.durationSeconds !== undefined);
    assert.ok(Math.abs(upload.durationSeconds - 3) < 0.5);
  });

  it("refuses a video over ninety seconds, and says so plainly", async () => {
    const { uploadId } = await arrive("video-too-long.mp4", "video");

    assert.equal(await uploads.check(uploadId), false);

    const upload = await repository.findById(uploadId);

    assert.equal(upload?.state, "failed");
    assert.match(upload?.failureReason ?? "", /90 seconds/);
  });

  it("refuses a file that only claims to be a photograph", async () => {
    // The hole the previous sub-phase documented: the uploader declared an
    // image consistently, and storage repeated the claim back. Only opening
    // the file settles it.
    const { uploadId } = await arrive("not-really-a-photo.jpg", "image");

    assert.equal(await uploads.check(uploadId), false);

    const upload = await repository.findById(uploadId);

    assert.equal(upload?.state, "failed");
    assert.ok((upload?.failureReason ?? "").length > 0);
  });

  it("refuses a genuine video uploaded as a photograph", async () => {
    const { uploadId } = await arrive("video-short.mp4", "image");

    assert.equal(await uploads.check(uploadId), false);

    assert.equal((await repository.findById(uploadId))?.state, "failed");
  });

  it("records a permanent failure as permanent, so it is never retried", async () => {
    const { uploadId } = await arrive("video-too-long.mp4", "video");
    await uploads.check(uploadId);

    const rows: { failure_category: string; attempts: number }[] = await database.dataSource.query(
      `SELECT failure_category, attempts FROM uploads WHERE upload_id = $1`,
      [uploadId],
    );

    assert.equal(rows[0]?.failure_category, "permanent");
    assert.equal(rows[0]?.attempts, 1);
  });

  it("does not check the same file twice", async () => {
    // At-least-once delivery makes this ordinary rather than exceptional. The
    // second call must find the upload already settled and do no work, which
    // shows as an unchanged check time and no further attempt counted.
    const { uploadId } = await arrive("photo.jpg", "image");

    assert.equal(await uploads.check(uploadId), true);

    const after = await database.dataSource.query(
      `SELECT checked_at, attempts FROM uploads WHERE upload_id = $1`,
      [uploadId],
    );

    assert.equal(await uploads.check(uploadId), true);

    const again = await database.dataSource.query(
      `SELECT checked_at, attempts FROM uploads WHERE upload_id = $1`,
      [uploadId],
    );

    assert.deepEqual(again[0]?.checked_at, after[0]?.checked_at, "it was checked twice");
    assert.equal(again[0]?.attempts, after[0]?.attempts, "a second attempt was counted");
  });

  it("counts an attempt before doing the work, so a fatal file leaves a trace", async () => {
    const { uploadId } = await arrive("photo.jpg", "image");
    await uploads.check(uploadId);

    const rows: { attempts: number }[] = await database.dataSource.query(
      `SELECT attempts FROM uploads WHERE upload_id = $1`,
      [uploadId],
    );

    assert.equal(rows[0]?.attempts, 1);
  });

  describe("what crosses the boundary", () => {
    it("announces only what a checker needs, never internal detail", async () => {
      // The translation is now the service's own act rather than a publisher's
      // (ADR-096), so this reads the message actually enqueued instead of calling
      // a translator directly.
      const { uploadId, ownerUserId } = await arrive("photo.jpg", "image");

      const rows: { payload: Record<string, unknown> }[] = await database.dataSource.query(
        `SELECT payload FROM outbox_messages
          WHERE aggregate_id = $1 AND event_type = 'UploadReceived'`,
        [uploadId],
      );

      assert.equal(rows.length, 1, "arrival was announced exactly once");
      assert.deepEqual(Object.keys(rows[0]!.payload).sort(), [
        "kind",
        "ownerUserId",
        "receivedAt",
        "storageKey",
        "uploadId",
      ]);
      assert.equal(rows[0]!.payload.ownerUserId, ownerUserId);

      // The size, the content type and the checksum stay internal. They exist so
      // that a mismatch between claim and object is answerable later, which is
      // not a consumer's business.
      assert.doesNotMatch(JSON.stringify(rows[0]!.payload), /checksum|contentType|byteSize/);
    });

    it("announces nothing for the states that have no consumer", async () => {
      // Registration is an intention rather than a fact about a file; failure and
      // deletion are the API's own business. None has a consumer, and publishing
      // without one is how internal state quietly becomes a contract.
      const { uploadId } = await arrive("photo.jpg", "image");

      await uploads.check(uploadId);
      await uploads.delete(uploadId, (await repository.findRecord(uploadId))?.ownerUserId ?? "");

      const rows: { event_type: string }[] = await database.dataSource.query(
        `SELECT event_type FROM outbox_messages WHERE aggregate_id = $1`,
        [uploadId],
      );

      assert.deepEqual(
        rows.map((row) => row.event_type),
        ["UploadReceived"],
      );
    });
  });
});

describe("handling a note from the queue", () => {
  let database: Database;
  let uploads: UploadService;
  let repository: UploadRepository;
  let storage: StorageClient;

  beforeAll(async () => {
    database = createDatabase({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      database: process.env.POSTGRES_DATABASE ?? "chronologity",
      user: process.env.POSTGRES_USER ?? "chronologity",
      password: process.env.POSTGRES_PASSWORD ?? "chronologity",
    });
    await connectDatabase(database);

    storage = createStorageClient(storageConfig);
    repository = new UploadRepository(database.dataSource);
    uploads = new UploadService(
      database.dataSource,
      repository,
      storage,
      {
        registrationTtlSeconds: 3_600,
        maxImageBytes: 26_214_400,
        maxVideoBytes: 524_288_000,
      },
      { metadata: createMetadataClient(), derivatives: createDerivativeClient() },
    );
  });

  afterAll(async () => {
    storage.close();
    await database.close();
  });

  const noteAbout = (payload: unknown): ConsumedEvent => ({
    topic: "chronologity.media.v1",
    partition: 0,
    offset: "0",
    envelope: {
      eventId: randomUUID(),
      eventType: "UploadReceived",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      aggregate: { type: "upload", id: randomUUID(), version: 1 },
      payload,
    },
  });

  it("ignores a note about an upload that no longer exists", async () => {
    // Deleted between arriving and being checked. Retrying forever would be
    // the wrong answer to someone asking for their file to be gone.
    const payload: UploadReceivedPayload = {
      uploadId: randomUUID(),
      ownerUserId: randomUUID(),
      kind: "image",
      storageKey: "uploads/nobody/nothing/original",
      receivedAt: new Date().toISOString(),
    };

    await checkArrivedMedia(uploads, noteAbout(payload));
  });

  it("ignores a note whose contents do not match the contract", async () => {
    // Retrying cannot repair a malformed message, so it must not loop.
    await checkArrivedMedia(uploads, noteAbout({ nonsense: true }));
  });
});

describe("a file that arrives over the broker rather than by hand", () => {
  let database: Database;
  let uploads: UploadService;
  let repository: UploadRepository;
  let storage: StorageClient;

  beforeAll(async () => {
    database = createDatabase({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      database: process.env.POSTGRES_DATABASE ?? "chronologity",
      user: process.env.POSTGRES_USER ?? "chronologity",
      password: process.env.POSTGRES_PASSWORD ?? "chronologity",
    });
    await connectDatabase(database);

    storage = createStorageClient(storageConfig);
    repository = new UploadRepository(database.dataSource);
    uploads = new UploadService(
      database.dataSource,
      repository,
      storage,
      {
        registrationTtlSeconds: 3_600,
        maxImageBytes: 26_214_400,
        maxVideoBytes: 524_288_000,
      },
      { metadata: createMetadataClient(), derivatives: createDerivativeClient() },
    );
  });

  afterAll(async () => {
    storage.close();
    await database.close();
  });

  it("is opened and measured after travelling outbox, broker, and worker", async () => {
    // Everything above this proves the checking. This proves the wiring: the
    // boundary comes from the worker's own exported list, which is what
    // `index.ts` subscribes with, so a wrong topic name fails here and only
    // here.
    const { userId: ownerUserId } = await createUser(database.dataSource);
    const bytes = await readFile(fixture("photo.jpg"));

    const authorization = await uploads.register(ownerUserId, {
      contentType: "image/jpeg",
      declaredByteSize: bytes.byteLength,
    });

    await fetch(authorization.uploadUrl, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": "image/jpeg" },
    });

    await uploads.finalize(
      authorization.uploadId,
      ownerUserId,
      systemContext(randomUUID(), new Date()),
    );

    const delivered = await deliverThroughBroker({
      dataSource: database.dataSource,
      boundaries: MEDIA_CHECKER_BOUNDARIES,
      aggregateId: authorization.uploadId,
      handler: (event) => checkArrivedMedia(uploads, event),
      clientId: "media-checker-broker",
    });

    const upload = await repository.findById(authorization.uploadId);

    assert.ok(delivered > 0);
    assert.equal(upload?.state, "ready");
    assert.equal(upload?.width, 640);
  });
});
