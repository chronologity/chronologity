import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, it } from "vitest";
import { CreateBucketCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { checkUpload } from "../../features/uploads/commands/check-upload.command.js";
import { handleCheckUpload } from "../../features/uploads/commands/check-upload.handler.js";
import { deleteUpload } from "../../features/uploads/commands/delete-upload.command.js";
import { handleDeleteUpload } from "../../features/uploads/commands/delete-upload.handler.js";
import { finalizeUpload } from "../../features/uploads/commands/finalize-upload.command.js";
import { handleFinalizeUpload } from "../../features/uploads/commands/finalize-upload.handler.js";
import { registerUpload } from "../../features/uploads/commands/register-upload.command.js";
import { handleRegisterUpload } from "../../features/uploads/commands/register-upload.handler.js";
import type { UploadDependencies } from "../../features/uploads/dependencies.js";
import { readUpload } from "../../features/uploads/utils/upload-read-model.js";
import { derivativeKey, uploadPrefix } from "../../features/uploads/utils/storage-key.js";
import { createDerivativeClient } from "../../integrations/metadata/derivative-client.js";
import { createMetadataClient } from "../../integrations/metadata/metadata-client.js";
import { createStorageClient } from "../../integrations/storage/storage-client.js";
import { migrate } from "../../lib/database/migrations.js";
import { createDatabase, type Database } from "../../lib/database/postgres.js";
import { createEventStore, type EventStore } from "../../lib/eventstore/client.js";
import { readStream } from "../../lib/eventstore/read-stream.js";
import { streamName } from "../../lib/eventstore/stream-name.js";
import { systemContext } from "../../types/request-context.js";

/**
 * Producing the files that make media showable, against real storage.
 *
 * The derivatives are inspected rather than assumed: a thumbnail is decoded to
 * confirm it is an image of the expected width, and the repackaged video is
 * examined byte by byte to confirm its playback information really did move to
 * the front. Asserting that a command exited successfully would prove only
 * that ffmpeg ran.
 *
 * Requires `pnpm infra:up` and ffmpeg on PATH.
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

describe("producing derivatives", () => {
  let database: Database;
  let eventStore: EventStore;
  let deps: UploadDependencies;
  let s3: S3Client;

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

    s3 = new S3Client({
      endpoint: storageConfig.endpoint,
      region: storageConfig.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: storageConfig.accessKeyId,
        secretAccessKey: storageConfig.secretAccessKey,
      },
    });

    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (error) {
      const name = (error as { name?: string }).name;

      if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
        throw error;
      }
    }

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
    s3.destroy();
    await eventStore.close();
    await database.close();
  });

  const context = () => systemContext(randomUUID(), new Date());

  /** Fetch a stored object's bytes. */
  const fetchObject = async (key: string): Promise<Buffer> => {
    const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const chunks: Uint8Array[] = [];

    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  };

  /** Put a real file all the way through: authorised, uploaded, arrived, checked. */
  const runThrough = async (file: string, declaredKind: "image" | "video") => {
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

    assert.equal(put.status, 200);

    await handleFinalizeUpload(
      deps,
      finalizeUpload(authorization.uploadId, ownerUserId),
      context(),
    );

    const accepted = await handleCheckUpload(deps, checkUpload(authorization.uploadId), context());

    return { uploadId: authorization.uploadId, ownerUserId, accepted };
  };

  it("gives a photograph a preview that is a real, smaller image", async () => {
    const { uploadId, ownerUserId, accepted } = await runThrough("photo.jpg", "image");

    assert.equal(accepted, true);

    const upload = await readUpload(database.pool, uploadId);
    assert.deepEqual(upload?.derivatives, ["thumbnail"]);

    // Decoded rather than assumed: the bytes must actually be an image, and a
    // narrower one than the 640px original.
    const bytes = await fetchObject(derivativeKey(ownerUserId, uploadId, "thumbnail"));
    assert.ok(bytes.byteLength > 0);
    assert.equal(bytes[0], 0xff, "not a JPEG");
    assert.equal(bytes[1], 0xd8, "not a JPEG");

    const probe = await deps.metadata.probe(
      await deps.storage.presignDownload(derivativeKey(ownerUserId, uploadId, "thumbnail")),
    );

    assert.equal(probe.width, 480);
    assert.equal(probe.hasMotion, false, "a preview must be a still picture");
  });

  it("gives a video a still frame and a copy that starts immediately", async () => {
    const { uploadId, ownerUserId, accepted } = await runThrough("video-slow-start.mp4", "video");

    assert.equal(accepted, true);

    const upload = await readUpload(database.pool, uploadId);
    assert.deepEqual([...(upload?.derivatives ?? [])].sort(), ["faststart", "poster"]);

    const poster = await fetchObject(derivativeKey(ownerUserId, uploadId, "poster"));
    assert.equal(poster[0], 0xff, "the still frame is not a JPEG");
    assert.equal(poster[1], 0xd8, "the still frame is not a JPEG");
  });

  it("actually moves the playback information to the front", async () => {
    // The point of the whole derivative. Verified by finding the marker in the
    // bytes rather than by trusting that ffmpeg did what was asked.
    const original = await readFile(fixture("video-slow-start.mp4"));
    const originalAt = original.indexOf(Buffer.from("moov"));

    assert.ok(
      originalAt > original.byteLength / 2,
      `the fixture should start slowly; its marker is at ${originalAt} of ${original.byteLength}`,
    );

    const { uploadId, ownerUserId } = await runThrough("video-slow-start.mp4", "video");
    const rewritten = await fetchObject(derivativeKey(ownerUserId, uploadId, "faststart"));
    const rewrittenAt = rewritten.indexOf(Buffer.from("moov"));

    assert.ok(
      rewrittenAt >= 0 && rewrittenAt < 1_024,
      `expected the marker near the front, found it at ${rewrittenAt}`,
    );
  });

  it("keeps the original untouched", async () => {
    // Derivatives are for showing media. Losing or altering what someone
    // actually uploaded would be unrecoverable.
    const original = await readFile(fixture("photo.jpg"));
    const { uploadId, ownerUserId } = await runThrough("photo.jpg", "image");

    const stored = await fetchObject(`${uploadPrefix(ownerUserId, uploadId)}/original`);

    assert.deepEqual(stored, original);
  });

  it("does not produce a second set when asked again", async () => {
    const { uploadId } = await runThrough("photo.jpg", "image");

    assert.equal(await handleCheckUpload(deps, checkUpload(uploadId), context()), true);

    const recorded = await readStream(eventStore.client, streamName("upload", uploadId));
    const produced = recorded.filter((event) => event.type === "UploadDerivativesProduced");

    assert.equal(produced.length, 1, "derivatives were produced twice");
  });

  it("produces nothing for a file that fails checking", async () => {
    const { uploadId, ownerUserId, accepted } = await runThrough("video-too-long.mp4", "video");

    assert.equal(accepted, false);

    const upload = await readUpload(database.pool, uploadId);
    assert.equal(upload?.state, "failed");
    assert.deepEqual(upload?.derivatives, []);

    const stored = await deps.storage.list(uploadPrefix(ownerUserId, uploadId));

    assert.deepEqual(
      stored.filter((key) => !key.endsWith("/original")),
      [],
      "a refused upload should have no derivatives",
    );
  });

  it("removes derivatives when the upload is deleted", async () => {
    const { uploadId, ownerUserId } = await runThrough("video-slow-start.mp4", "video");

    const before = await deps.storage.list(uploadPrefix(ownerUserId, uploadId));
    assert.equal(before.length, 3, `expected original and two derivatives, found ${before.length}`);

    await handleDeleteUpload(deps, deleteUpload(uploadId, ownerUserId), context());

    const after = await deps.storage.list(uploadPrefix(ownerUserId, uploadId));

    assert.deepEqual(after, [], "deleted media is still in storage");
  });
});
