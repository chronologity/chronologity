import assert from "node:assert/strict";
import { testAppConfig } from "../../testing/app-config.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it } from "vitest";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { FastifyInstance } from "fastify";
import { createDerivativeClient } from "../../integrations/metadata/derivative-client.js";
import { createMetadataClient } from "../../integrations/metadata/metadata-client.js";
import {
  createStorageClient,
  type StorageClient,
} from "../../integrations/storage/storage-client.js";
import { migrate } from "../../lib/database/migrations.js";
import { connectDatabase, createDatabase, type Database } from "../../lib/database/postgres.js";
import { createEmbeddedLocationClient } from "../../integrations/metadata/embedded-location-client.js";
import { createRecordedPlaceSearchClient } from "../../integrations/places/recorded-place-search-client.js";
import { LocationRepository } from "../locations/location.repository.js";
import { LocationService } from "../locations/location.service.js";
import { buildApp } from "../../server/app.js";
import { createTestAuthentication, type TestAuthentication } from "../../testing/authentication.js";
import { UploadRepository } from "./upload.repository.js";
import { UploadService } from "./upload.service.js";
import { UserRepository } from "../users/user.repository.js";
import { UserService } from "../users/user.service.js";

/**
 * Uploads, end to end against real object storage.
 *
 * The bytes actually travel to SeaweedFS through a presigned URL, because the
 * properties under test are exactly the ones a stub would assume: that a
 * signature authorises one key and not another, that the server measures what
 * arrived rather than believing what was claimed, and that a refused object
 * does not stay in storage.
 *
 * Requires `pnpm infra:up`. Run with `pnpm test:integration`.
 */

const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? "8025"}`;
// One bucket, reused. A bucket per run reads as careful and is a disk leak:
// SeaweedFS reserves storage files per bucket and never reclaims them, so a
// few runs consumed 29GB and filled this machine's Docker disk. Runs are
// already isolated by key — every upload gets a fresh identifier, so no two
// runs can collide on an object.
const BUCKET = process.env.S3_BUCKET ?? "chronologity-media";

// Small enough to keep the suite quick, large enough that "over the limit"
// needs a deliberately oversized body rather than an accident.
const MAX_IMAGE_BYTES = 1_024;

const config = testAppConfig("uploads-integration");

const ADULT = "1990-04-12";
const uniqueEmail = () => `person-${randomUUID()}@example.test`;
const uniqueHandle = () => `h${randomUUID().replaceAll("-", "").slice(0, 12)}`;

describe("uploads", () => {
  let app: FastifyInstance;
  let database: Database;
  let authentication: TestAuthentication;
  let users: UserService;
  let uploads: UploadService;
  let locations: LocationService;
  let storage: StorageClient;

  beforeAll(async () => {
    database = createDatabase(config.database);
    await connectDatabase(database);
    await migrate(database.dataSource);

    // Created if absent, tolerated if present: the bucket is shared across runs.
    const admin = new S3Client({
      endpoint: config.storage.endpoint,
      region: config.storage.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.storage.accessKeyId,
        secretAccessKey: config.storage.secretAccessKey,
      },
    });
    try {
      await admin.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (error) {
      // Already there, which is the normal case after the first run. Both
      // names are accepted: AWS answers BucketAlreadyOwnedByYou, SeaweedFS
      // answers BucketAlreadyExists, and either means the bucket is ready.
      const name = (error as { name?: string }).name;

      if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
        throw error;
      }
    }
    admin.destroy();

    storage = createStorageClient(config.storage);

    authentication = createTestAuthentication(database.dataSource, config.auth, config.email);

    users = new UserService(database.dataSource, new UserRepository(database.dataSource), {
      minimumAgeYears: config.minimumAgeYears,
    });

    uploads = new UploadService(
      database.dataSource,
      new UploadRepository(database.dataSource),
      storage,
      config.uploadLimits,
      {
        metadata: createMetadataClient(),
        derivatives: createDerivativeClient(),
        embeddedLocation: createEmbeddedLocationClient(storage, createMetadataClient()),
      },
    );

    locations = new LocationService(
      database.dataSource,
      new LocationRepository(database.dataSource),
      createRecordedPlaceSearchClient(),
    );

    app = await buildApp({
      config,
      dependencies: [],
      authentication,
      users,
      uploads,
      locations,
    });
  });

  afterAll(async () => {
    await app.close();
    await authentication.close();
    storage.close();
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

  const authed = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  /** Sign in and create an account, ending with an ordinary User. */
  const onboard = async () => {
    const email = uniqueEmail();
    await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
    const token = await readLinkFor(email);
    const session = await app.inject({
      method: "POST",
      url: "/auth/sessions",
      payload: { token },
    });

    assert.equal(session.statusCode, 201, session.body);

    const credentials = session.json();
    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authed(credentials.accessToken),
      payload: { handle: uniqueHandle(), displayName: "Test Person", dateOfBirth: ADULT },
    });

    assert.equal(created.statusCode, 201, created.body);

    return { credentials, user: created.json() };
  };

  const register = async (
    accessToken: string,
    body: { contentType?: string; declaredByteSize?: number } = {},
  ) =>
    app.inject({
      method: "POST",
      url: "/uploads",
      headers: authed(accessToken),
      payload: {
        contentType: body.contentType ?? "image/jpeg",
        declaredByteSize: body.declaredByteSize ?? 128,
      },
    });

  /** Upload bytes the way a client does: straight to storage, not through the API. */
  const put = async (url: string, body: Buffer, contentType = "image/jpeg") =>
    fetch(url, { method: "PUT", body, headers: { "content-type": contentType } });

  describe("what a photograph says about where it was taken", () => {
    const fixture = (name: string) =>
      fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));

    // A separate application with a realistic size limit. The suite's own limit
    // is deliberately tiny so that refusing an oversized file can be tested,
    // and a real photograph is larger than that by design.
    let roomy: FastifyInstance;

    beforeAll(async () => {
      roomy = await buildApp({
        config: {
          ...config,
          uploadLimits: { ...config.uploadLimits, maxImageBytes: 26_214_400 },
        },
        dependencies: [],
        authentication,
        users,
        uploads: new UploadService(
          database.dataSource,
          new UploadRepository(database.dataSource),
          storage,
          { ...config.uploadLimits, maxImageBytes: 26_214_400 },
          {
            metadata: createMetadataClient(),
            derivatives: createDerivativeClient(),
            embeddedLocation: createEmbeddedLocationClient(storage, createMetadataClient()),
          },
        ),
        locations,
      });
    });

    afterAll(() => roomy.close());

    /** Register a real file, put it in storage, and finalize it. */
    const arrive = async (accessToken: string, file: string) => {
      const bytes = await readFile(fixture(file));
      const registered = await roomy.inject({
        method: "POST",
        url: "/uploads",
        headers: authed(accessToken),
        payload: { contentType: "image/jpeg", declaredByteSize: bytes.byteLength },
      });
      assert.equal(registered.statusCode, 201, registered.body);

      const { uploadId, uploadUrl } = registered.json();

      assert.equal((await put(uploadUrl, bytes)).status, 200);

      const finalized = await roomy.inject({
        method: "POST",
        url: `/uploads/${uploadId}/finalize`,
        headers: authed(accessToken),
      });
      assert.equal(finalized.statusCode, 200, finalized.body);

      return uploadId;
    };

    const askFor = async (uploadId: string, accessToken: string) =>
      roomy.inject({
        method: "GET",
        url: `/uploads/${uploadId}/places`,
        headers: authed(accessToken),
      });

    it("offers the places its own coordinates point at", async () => {
      const { credentials } = await onboard();
      const uploadId = await arrive(credentials.accessToken, "photo-with-gps.jpg");

      const response = await askFor(uploadId, credentials.accessToken);

      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().found, true);
      assert.ok(response.json().suggestions.length > 0);
      assert.equal(response.json().suggestions[0].name, "Big Ben");
      // ODbL requires crediting contributors wherever the data appears.
      assert.match(response.json().attribution, /OpenStreetMap/);
    });

    it("answers with named places rather than the position it read", async () => {
      const { credentials } = await onboard();
      const uploadId = await arrive(credentials.accessToken, "photo-with-gps.jpg");

      const body = await askFor(uploadId, credentials.accessToken).then((r) => r.json());

      // The camera's position is used to ask what is there and is not a field
      // of the answer. What comes back carries coordinates, but they are the
      // map service's for a public landmark rather than the photograph's — the
      // exact spot somebody stood is generalised to a place with a name
      // (`locations.md:373`).
      assert.deepEqual(Object.keys(body).sort(), ["attribution", "found", "suggestions"]);

      const suggestion = body.suggestions[0];
      assert.equal(suggestion.name, "Big Ben");
      assert.ok(suggestion.coordinates !== undefined, "a named place carries its own position");
      assert.match(suggestion.reference, /^[a-z]+:\d+$/);
    });

    it("stores nothing it read", async () => {
      const { credentials } = await onboard();
      const uploadId = await arrive(credentials.accessToken, "photo-with-gps.jpg");

      const before = await database.dataSource.query(
        `SELECT count(*) FROM locations`,
      );
      await askFor(uploadId, credentials.accessToken);
      const after = await database.dataSource.query(`SELECT count(*) FROM locations`);

      // Asking is not recording. Copying the coordinates into a database would
      // create a second thing to leak, to keep in step with privacy rules, and
      // to remember during erasure.
      assert.equal(after[0]?.count, before[0]?.count);

      // And nothing about position reached the upload's own row either. What is
      // recorded there is what opening the file established — dimensions, codec,
      // duration — never where it was taken.
      const columns = await database.dataSource.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'uploads' AND column_name ~ 'lat|lon|location|coord'`,
      );
      assert.deepEqual(columns, []);
    });

    it("says a photograph carrying no location carries none", async () => {
      const { credentials } = await onboard();
      const uploadId = await arrive(credentials.accessToken, "photo.jpg");

      const response = await askFor(uploadId, credentials.accessToken);

      // Absence is the ordinary case rather than a failure: most files carry no
      // location. `found` distinguishes it from a position nothing could name,
      // which is the case worth offering a manual search for.
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().found, false);
      assert.deepEqual(response.json().suggestions, []);
    });

    it("refuses somebody else's upload exactly as one that does not exist", async () => {
      const mine = await onboard();
      const theirs = await onboard();
      const uploadId = await arrive(mine.credentials.accessToken, "photo-with-gps.jpg");

      const asTheirs = await askFor(uploadId, theirs.credentials.accessToken);
      const asMissing = await askFor(randomUUID(), theirs.credentials.accessToken);

      assert.equal(asTheirs.statusCode, 404);
      assert.equal(asMissing.statusCode, 404);
      assert.deepEqual(asTheirs.json().code, asMissing.json().code);
    });
  });

  describe("the upload flow", () => {
    it("registers, uploads directly to storage, and finalizes", async () => {
      const { credentials } = await onboard();

      const registered = await register(credentials.accessToken);
      assert.equal(registered.statusCode, 201, registered.body);

      const { uploadId, uploadUrl, kind } = registered.json();
      assert.equal(kind, "image");

      const uploaded = await put(uploadUrl, Buffer.from("a photograph"));
      assert.equal(uploaded.status, 200, "the presigned URL did not accept the bytes");

      const finalized = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/finalize`,
        headers: authed(credentials.accessToken),
      });

      assert.equal(finalized.statusCode, 200, finalized.body);
      assert.equal(finalized.json().state, "received");
      // Measured, not declared: registration said 128, the object is 12.
      assert.equal(finalized.json().byteSize, Buffer.from("a photograph").length);
      assert.equal(finalized.json().declaredByteSize, 128);
    });

    it("never returns a storage key or a durable URL", async () => {
      const { credentials } = await onboard();
      const { uploadId, uploadUrl } = (await register(credentials.accessToken)).json();
      await put(uploadUrl, Buffer.from("a photograph"));
      await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/finalize`,
        headers: authed(credentials.accessToken),
      });

      const read = await app.inject({
        method: "GET",
        url: `/uploads/${uploadId}`,
        headers: authed(credentials.accessToken),
      });

      const body = JSON.stringify(read.json());
      assert.doesNotMatch(body, /storageKey|uploads\//);
      assert.doesNotMatch(body, /X-Amz-Signature/);
    });

    it("is idempotent: finalizing twice does not receive it twice", async () => {
      const { credentials } = await onboard();
      const { uploadId, uploadUrl } = (await register(credentials.accessToken)).json();
      await put(uploadUrl, Buffer.from("a photograph"));

      const finalize = async () =>
        app.inject({
          method: "POST",
          url: `/uploads/${uploadId}/finalize`,
          headers: authed(credentials.accessToken),
        });

      const first = await finalize();
      const second = await finalize();

      assert.equal(first.statusCode, 200);
      assert.equal(second.statusCode, 200);
      assert.equal(second.json().receivedAt, first.json().receivedAt);
    });

    it("lists someone's own uploads", async () => {
      const { credentials } = await onboard();
      await register(credentials.accessToken);
      await register(credentials.accessToken);

      const listed = await app.inject({
        method: "GET",
        url: "/uploads",
        headers: authed(credentials.accessToken),
      });

      assert.equal(listed.json().uploads.length, 2);
    });
  });

  describe("verification", () => {
    it("refuses to finalize when nothing was uploaded", async () => {
      const { credentials } = await onboard();
      const { uploadId } = (await register(credentials.accessToken)).json();

      const finalized = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/finalize`,
        headers: authed(credentials.accessToken),
      });

      assert.equal(finalized.statusCode, 400);

      const read = await app.inject({
        method: "GET",
        url: `/uploads/${uploadId}`,
        headers: authed(credentials.accessToken),
      });

      assert.equal(read.json().state, "failed");
      assert.match(read.json().failureReason, /uploaded/i);
    });

    it("refuses an object over the limit and deletes it from storage", async () => {
      const { credentials } = await onboard();
      // Declared small, sent large: the presigned signature cannot bound what
      // a client actually writes, which is why the check happens afterwards.
      const { uploadId, uploadUrl } = (await register(credentials.accessToken)).json();

      const uploaded = await put(uploadUrl, Buffer.alloc(MAX_IMAGE_BYTES + 1, "x"));
      assert.equal(uploaded.status, 200, "storage accepted the oversized object, as expected");

      const finalized = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/finalize`,
        headers: authed(credentials.accessToken),
      });

      assert.equal(finalized.statusCode, 400);

      // The refusal is only complete if the bytes are gone: an object nobody
      // can reference is an object nobody should be paying to store.
      const rows: { storage_key: string }[] = await database.dataSource.query(
        `SELECT storage_key FROM uploads WHERE upload_id = $1`,
        [uploadId],
      );
      assert.equal(await storage.head(rows[0]!.storage_key), undefined);
    });

    it("refuses a declared size already over the limit, before anything is uploaded", async () => {
      const { credentials } = await onboard();

      const registered = await register(credentials.accessToken, {
        declaredByteSize: MAX_IMAGE_BYTES + 1,
      });

      assert.equal(registered.statusCode, 400);
    });

    it("refuses a content type the product does not accept", async () => {
      const { credentials } = await onboard();

      for (const contentType of ["application/pdf", "image/svg+xml", "text/html"]) {
        const registered = await register(credentials.accessToken, { contentType });

        assert.equal(registered.statusCode, 400, contentType);
      }
    });
  });

  describe("the presigned URL", () => {
    it("does not authorise writing to a different key", async () => {
      // The reason the server generates keys. If a signature covered any key,
      // a client could overwrite another person's object.
      const { credentials } = await onboard();
      const { uploadUrl } = (await register(credentials.accessToken)).json();

      const tampered = uploadUrl.replace(/\/original\?/, "/original-elsewhere?");
      const written = await put(tampered, Buffer.from("someone else's bytes"));

      assert.equal(written.status, 403, "storage accepted a write outside the signature");
    });

    it("does not itself enforce the signed content type, so finalization must", async () => {
      // A finding about this storage implementation rather than about the
      // upload flow: AWS binds Content-Type into the signature, and SeaweedFS
      // accepts a PUT that contradicts it. Assuming otherwise would have made
      // the declared type load-bearing, so the test states what is true and
      // proves the check that actually holds the line.
      const { credentials } = await onboard();
      const { uploadId, uploadUrl } = (await register(credentials.accessToken)).json();

      const written = await put(uploadUrl, Buffer.from("not an image"), "application/pdf");
      assert.equal(written.status, 200, "storage accepted a contradicting content type");

      const finalized = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/finalize`,
        headers: authed(credentials.accessToken),
      });

      assert.equal(finalized.statusCode, 400, "finalization accepted the wrong media type");

      // And the object does not survive its refusal.
      const rows: { storage_key: string }[] = await database.dataSource.query(
        `SELECT storage_key FROM uploads WHERE upload_id = $1`,
        [uploadId],
      );
      assert.equal(await storage.head(rows[0]!.storage_key), undefined);
    });
  });

  describe("ownership", () => {
    it("hides another person's upload rather than refusing it", async () => {
      const owner = await onboard();
      const stranger = await onboard();
      const { uploadId } = (await register(owner.credentials.accessToken)).json();

      const read = await app.inject({
        method: "GET",
        url: `/uploads/${uploadId}`,
        headers: authed(stranger.credentials.accessToken),
      });

      // 404 rather than 403: whether someone else's upload exists is not the
      // caller's business.
      assert.equal(read.statusCode, 404);
    });

    it("refuses to let a stranger finalize or delete an upload", async () => {
      const owner = await onboard();
      const stranger = await onboard();
      const { uploadId, uploadUrl } = (await register(owner.credentials.accessToken)).json();
      await put(uploadUrl, Buffer.from("a photograph"));

      const finalized = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/finalize`,
        headers: authed(stranger.credentials.accessToken),
      });
      assert.equal(finalized.statusCode, 404);

      const deleted = await app.inject({
        method: "DELETE",
        url: `/uploads/${uploadId}`,
        headers: authed(stranger.credentials.accessToken),
      });
      assert.equal(deleted.statusCode, 404);

      // Still usable by its actual owner, so neither attempt half-succeeded.
      const byOwner = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/finalize`,
        headers: authed(owner.credentials.accessToken),
      });
      assert.equal(byOwner.statusCode, 200);
    });

    it("does not list another person's uploads", async () => {
      const owner = await onboard();
      const stranger = await onboard();
      await register(owner.credentials.accessToken);

      const listed = await app.inject({
        method: "GET",
        url: "/uploads",
        headers: authed(stranger.credentials.accessToken),
      });

      assert.deepEqual(listed.json().uploads, []);
    });

    it("hands back a page and where to continue from", async () => {
      const { credentials } = await onboard();
      for (let index = 0; index < 3; index += 1) {
        await register(credentials.accessToken);
      }

      const first = await app.inject({
        method: "GET",
        url: "/uploads?limit=2",
        headers: authed(credentials.accessToken),
      });

      assert.equal(first.json().uploads.length, 2);
      assert.notEqual(first.json().nextCursor, undefined);
    });

    it("says it has reached the end by offering nowhere to continue", async () => {
      const { credentials } = await onboard();
      await register(credentials.accessToken);

      const listed = await app.inject({
        method: "GET",
        url: "/uploads?limit=2",
        headers: authed(credentials.accessToken),
      });

      // A short page is the end. Absence is the signal, so a client knows to
      // stop without a further request that would come back empty.
      assert.equal(listed.json().uploads.length, 1);
      assert.equal(listed.json().nextCursor, undefined);
    });

    it("pages the whole list without skipping a tie", async () => {
      const { credentials, user } = await onboard();
      const registered: string[] = [];

      for (let index = 0; index < 5; index += 1) {
        registered.push((await register(credentials.accessToken)).json().uploadId);
      }

      // A phone handing over a burst registers several in the same instant.
      await database.dataSource.query(
        `UPDATE uploads SET registered_at = '2026-01-01T00:00:00Z' WHERE owner_user_id = $1`,
        [user.userId],
      );

      const seen: string[] = [];
      let cursor: string | undefined;

      do {
        const response = await app.inject({
          method: "GET",
          url: `/uploads?limit=2${cursor === undefined ? "" : `&cursor=${cursor}`}`,
          headers: authed(credentials.accessToken),
        });

        assert.ok(response.json().uploads.length <= 2, "the limit was not honoured");
        seen.push(...response.json().uploads.map((upload: { uploadId: string }) => upload.uploadId));
        cursor = response.json().nextCursor;
      } while (cursor !== undefined);

      assert.equal(seen.length, 5, "a row was skipped or repeated");
      assert.deepEqual([...seen].sort(), [...registered].sort());
    });

    it("refuses a cursor it did not issue", async () => {
      const { credentials } = await onboard();

      const listed = await app.inject({
        method: "GET",
        url: "/uploads?cursor=not-a-cursor",
        headers: authed(credentials.accessToken),
      });

      // Refused rather than ignored: starting again from the beginning would
      // hand back a page the caller believes it has already read.
      assert.equal(listed.statusCode, 400, listed.body);
    });

    it("refuses a page larger than the bound", async () => {
      const { credentials } = await onboard();

      const listed = await app.inject({
        method: "GET",
        url: "/uploads?limit=1000",
        headers: authed(credentials.accessToken),
      });

      assert.equal(listed.statusCode, 400, listed.body);
    });

    it("requires an account, not merely authentication", async () => {
      const email = uniqueEmail();
      await app.inject({ method: "POST", url: "/auth/magic-link", payload: { email } });
      const token = await readLinkFor(email);
      const session = await app.inject({
        method: "POST",
        url: "/auth/sessions",
        payload: { token },
      });

      const registered = await register(session.json().accessToken);

      assert.equal(registered.statusCode, 403);
      assert.equal(registered.json().code, "ONBOARDING_REQUIRED");
    });
  });

  describe("deletion", () => {
    it("removes the stored object", async () => {
      const { credentials } = await onboard();
      const { uploadId, uploadUrl } = (await register(credentials.accessToken)).json();
      await put(uploadUrl, Buffer.from("a photograph"));
      await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/finalize`,
        headers: authed(credentials.accessToken),
      });

      const rows: { storage_key: string }[] = await database.dataSource.query(
        `SELECT storage_key FROM uploads WHERE upload_id = $1`,
        [uploadId],
      );
      const key = rows[0]!.storage_key;
      assert.notEqual(await storage.head(key), undefined, "the object should exist first");

      const deleted = await app.inject({
        method: "DELETE",
        url: `/uploads/${uploadId}`,
        headers: authed(credentials.accessToken),
      });

      assert.equal(deleted.statusCode, 204);
      assert.equal(await storage.head(key), undefined, "the object outlived its upload");
    });

    it("reads as absent once deleted, and stops being listed", async () => {
      const { credentials } = await onboard();
      const { uploadId } = (await register(credentials.accessToken)).json();

      await app.inject({
        method: "DELETE",
        url: `/uploads/${uploadId}`,
        headers: authed(credentials.accessToken),
      });

      const read = await app.inject({
        method: "GET",
        url: `/uploads/${uploadId}`,
        headers: authed(credentials.accessToken),
      });
      assert.equal(read.statusCode, 404);

      const listed = await app.inject({
        method: "GET",
        url: "/uploads",
        headers: authed(credentials.accessToken),
      });
      assert.deepEqual(listed.json().uploads, []);
    });

    it("is idempotent", async () => {
      const { credentials } = await onboard();
      const { uploadId } = (await register(credentials.accessToken)).json();

      const remove = async () =>
        app.inject({
          method: "DELETE",
          url: `/uploads/${uploadId}`,
          headers: authed(credentials.accessToken),
        });

      assert.equal((await remove()).statusCode, 204);
      assert.equal((await remove()).statusCode, 204);
    });
  });

  describe("the stored record", () => {
    it("records the storage key, so bytes are never orphaned", async () => {
      // Recorded rather than recomputed. Deletion lists the prefix this key
      // sits under, so a key the record does not hold is media nothing can
      // find and nothing will ever remove.
      const { credentials } = await onboard();
      const { uploadId } = (await register(credentials.accessToken)).json();

      const rows: { storage_key: string }[] = await database.dataSource.query(
        `SELECT storage_key FROM uploads WHERE upload_id = $1`,
        [uploadId],
      );

      assert.match(rows[0]?.storage_key ?? "", /^uploads\/.+\/.+\/original$/);
    });
  });
});
