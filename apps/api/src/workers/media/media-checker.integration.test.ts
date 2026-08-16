import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, it } from "vitest";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { UploadReceivedPayload } from "@chronologity/contracts";
import { checkUpload } from "../../features/uploads/commands/check-upload.command.js";
import { handleCheckUpload } from "../../features/uploads/commands/check-upload.handler.js";
import { finalizeUpload } from "../../features/uploads/commands/finalize-upload.command.js";
import { handleFinalizeUpload } from "../../features/uploads/commands/finalize-upload.handler.js";
import { registerUpload } from "../../features/uploads/commands/register-upload.command.js";
import { handleRegisterUpload } from "../../features/uploads/commands/register-upload.handler.js";
import type { UploadDependencies } from "../../features/uploads/dependencies.js";
import { uploadRoute } from "../../features/uploads/integration-events.js";
import { readUpload } from "../../features/uploads/utils/upload-read-model.js";
import { createDerivativeClient } from "../../integrations/metadata/derivative-client.js";
import { createMetadataClient } from "../../integrations/metadata/metadata-client.js";
import { createStorageClient } from "../../integrations/storage/storage-client.js";
import { migrate } from "../../lib/database/migrations.js";
import { createDatabase, type Database } from "../../lib/database/postgres.js";
import { createEventStore, type EventStore } from "../../lib/eventstore/client.js";
import { readStream } from "../../lib/eventstore/read-stream.js";
import { streamName } from "../../lib/eventstore/stream-name.js";
import type { ConsumedEvent } from "../../lib/messaging/consumer.js";
import { systemContext } from "../../types/request-context.js";
import { checkArrivedMedia } from "./check-media.js";

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
  let eventStore: EventStore;
  let deps: UploadDependencies;

  beforeAll(async () => {
    database = createDatabase({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      database: process.env.POSTGRES_DATABASE ?? "chronologity",
      user: process.env.POSTGRES_USER ?? "chronologity",
      password: process.env.POSTGRES_PASSWORD ?? "chronologity",
    });
    eventStore = createEventStore({
      connectionString: process.env.EVENTSTOREDB_URL ?? "esdb://localhost:2113?tls=false",
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

    deps = {
      client: eventStore.client,
      pool: database.pool,
      storage: createStorageClient(storageConfig),
      metadata: createMetadataClient(),
      derivatives: createDerivativeClient(),
      limits: {
        registrationTtlSeconds: 3_600,
        maxImageBytes: 26_214_400,
        maxVideoBytes: 524_288_000,
      },
    };
  });

  afterAll(async () => {
    deps.storage.close();
    await eventStore.close();
    await database.close();
  });

  const context = () => systemContext(randomUUID(), new Date());

  /**
   * Put a real file through the whole path: authorised, uploaded, arrived.
   * Stops short of checking, which is what each test then exercises.
   */
  const arrive = async (file: string, declaredKind: "image" | "video") => {
    const ownerUserId = randomUUID();
    const contentType = declaredKind === "image" ? "image/jpeg" : "video/mp4";
    const bytes = await readFile(fixture(file));

    const authorization = await handleRegisterUpload(
      deps,
      registerUpload(ownerUserId, { contentType, declaredByteSize: bytes.byteLength }),
      context(),
    );

    const put = await fetch(authorization.uploadUrl, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": contentType },
    });

    assert.equal(put.status, 200, "the presigned link did not accept the file");

    await handleFinalizeUpload(
      deps,
      finalizeUpload(authorization.uploadId, ownerUserId),
      context(),
    );

    return { uploadId: authorization.uploadId, ownerUserId };
  };

  it("accepts a photograph, and records what it measured", async () => {
    const { uploadId } = await arrive("photo.jpg", "image");

    const accepted = await handleCheckUpload(deps, checkUpload(uploadId), context());

    assert.equal(accepted, true);

    const upload = await readUpload(database.pool, uploadId);

    assert.equal(upload?.state, "ready");
    assert.equal(upload?.mediaKind, "image");
    assert.equal(upload?.width, 640);
    assert.equal(upload?.height, 480);
    // A photograph has no length, and must not be given a fabricated one.
    assert.equal(upload?.durationSeconds, null);
  });

  it("accepts a video, and records its real length", async () => {
    const { uploadId } = await arrive("video-short.mp4", "video");

    assert.equal(await handleCheckUpload(deps, checkUpload(uploadId), context()), true);

    const upload = await readUpload(database.pool, uploadId);

    assert.equal(upload?.state, "ready");
    assert.equal(upload?.mediaKind, "video");
    assert.ok(upload?.durationSeconds !== null && upload?.durationSeconds !== undefined);
    assert.ok(Math.abs(upload.durationSeconds - 3) < 0.5);
  });

  it("refuses a video over ninety seconds, and says so plainly", async () => {
    const { uploadId } = await arrive("video-too-long.mp4", "video");

    assert.equal(await handleCheckUpload(deps, checkUpload(uploadId), context()), false);

    const upload = await readUpload(database.pool, uploadId);

    assert.equal(upload?.state, "failed");
    assert.match(upload?.failureReason ?? "", /90 seconds/);
  });

  it("refuses a file that only claims to be a photograph", async () => {
    // The hole the previous sub-phase documented: the uploader declared an
    // image consistently, and storage repeated the claim back. Only opening
    // the file settles it.
    const { uploadId } = await arrive("not-really-a-photo.jpg", "image");

    assert.equal(await handleCheckUpload(deps, checkUpload(uploadId), context()), false);

    const upload = await readUpload(database.pool, uploadId);

    assert.equal(upload?.state, "failed");
    assert.ok((upload?.failureReason ?? "").length > 0);
  });

  it("refuses a genuine video uploaded as a photograph", async () => {
    const { uploadId } = await arrive("video-short.mp4", "image");

    assert.equal(await handleCheckUpload(deps, checkUpload(uploadId), context()), false);

    assert.equal((await readUpload(database.pool, uploadId))?.state, "failed");
  });

  it("records a permanent failure as permanent, so it is never retried", async () => {
    const { uploadId } = await arrive("video-too-long.mp4", "video");
    await handleCheckUpload(deps, checkUpload(uploadId), context());

    const { rows } = await database.pool.query<{ failure_category: string; attempts: number }>(
      `SELECT failure_category, attempts FROM uploads WHERE upload_id = $1`,
      [uploadId],
    );

    assert.equal(rows[0]?.failure_category, "permanent");
    assert.equal(rows[0]?.attempts, 1);
  });

  it("does not check the same file twice", async () => {
    // At-least-once delivery makes this ordinary rather than exceptional.
    const { uploadId } = await arrive("photo.jpg", "image");

    assert.equal(await handleCheckUpload(deps, checkUpload(uploadId), context()), true);
    assert.equal(await handleCheckUpload(deps, checkUpload(uploadId), context()), true);

    const recorded = await readStream(eventStore.client, streamName("upload", uploadId));
    const checks = recorded.filter((event) => event.type === "UploadChecked");

    assert.equal(checks.length, 1, "the file was checked twice");
  });

  it("counts an attempt before doing the work, so a fatal file leaves a trace", async () => {
    const { uploadId } = await arrive("photo.jpg", "image");
    await handleCheckUpload(deps, checkUpload(uploadId), context());

    const { rows } = await database.pool.query<{ attempts: number }>(
      `SELECT attempts FROM uploads WHERE upload_id = $1`,
      [uploadId],
    );

    assert.equal(rows[0]?.attempts, 1);
  });
});

describe("handling a note from the queue", () => {
  let database: Database;
  let eventStore: EventStore;
  let deps: UploadDependencies;

  beforeAll(async () => {
    database = createDatabase({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      database: process.env.POSTGRES_DATABASE ?? "chronologity",
      user: process.env.POSTGRES_USER ?? "chronologity",
      password: process.env.POSTGRES_PASSWORD ?? "chronologity",
    });
    eventStore = createEventStore({
      connectionString: process.env.EVENTSTOREDB_URL ?? "esdb://localhost:2113?tls=false",
    });

    deps = {
      client: eventStore.client,
      pool: database.pool,
      storage: createStorageClient(storageConfig),
      metadata: createMetadataClient(),
      derivatives: createDerivativeClient(),
      limits: {
        registrationTtlSeconds: 3_600,
        maxImageBytes: 26_214_400,
        maxVideoBytes: 524_288_000,
      },
    };
  });

  afterAll(async () => {
    deps.storage.close();
    await eventStore.close();
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

    await checkArrivedMedia(deps, noteAbout(payload));
  });

  it("ignores a note whose contents do not match the contract", async () => {
    // Retrying cannot repair a malformed message, so it must not loop.
    await checkArrivedMedia(deps, noteAbout({ nonsense: true }));
  });
});

describe("what crosses the boundary", () => {
  it("publishes only what a checker needs, never internal history", () => {
    const published = uploadRoute.translate({
      type: "UploadReceived",
      payload: {
        uploadId: "u1",
        ownerUserId: "o1",
        kind: "image",
        storageKey: "uploads/o1/u1/original",
        byteSize: 4096,
        contentType: "image/jpeg",
        checksum: "abc123",
        receivedAt: "2026-08-16T12:00:00.000Z",
      },
    });

    assert.deepEqual(published, {
      uploadId: "u1",
      ownerUserId: "o1",
      kind: "image",
      storageKey: "uploads/o1/u1/original",
      receivedAt: "2026-08-16T12:00:00.000Z",
    });

    // The size, the content type and the checksum stay internal. They exist so
    // that a mismatch between claim and object is answerable later, which is
    // not a consumer's business.
    const serialised = JSON.stringify(published);

    assert.doesNotMatch(serialised, /4096|checksum|contentType/);
  });

  it("publishes nothing for events with no consumer", () => {
    for (const type of ["UploadRegistered", "UploadFailed", "UploadDeleted", "UploadChecked"]) {
      assert.equal(uploadRoute.translate({ type, payload: {} }), undefined, type);
    }
  });
});
