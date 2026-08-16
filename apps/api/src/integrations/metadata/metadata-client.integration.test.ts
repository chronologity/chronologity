import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { checkMedia } from "../../features/uploads/media-policy.js";
import { createMetadataClient } from "./metadata-client.js";

/**
 * Reading real files with a real decoder.
 *
 * These use committed fixtures rather than stubs because the thing under test
 * is what ffprobe actually reports, and a stub would only assert what I
 * assumed it reports. That distinction is not academic: the first version of
 * this adapter refused every photograph as a video, because a single JPEG is
 * reported as lasting 0.04 seconds and duration looked like a reasonable way
 * to tell a picture from a film. Only real files revealed it.
 *
 * Requires ffprobe on PATH. No other infrastructure.
 */

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../features/uploads/__fixtures__/${name}`, import.meta.url));

const client = createMetadataClient();

describe("probing real media", () => {
  it("reads a photograph as a still picture", async () => {
    const probe = await client.probe(fixture("photo.jpg"));

    assert.equal(probe.hasMotion, false, "a photograph must not read as moving");
    assert.equal(probe.codec, "mjpeg");
    assert.equal(probe.width, 640);
    assert.equal(probe.height, 480);
  });

  it("reads a video as moving, with its real length", async () => {
    const probe = await client.probe(fixture("video-short.mp4"));

    assert.equal(probe.hasMotion, true);
    assert.equal(probe.codec, "h264");
    assert.ok(probe.durationSeconds !== undefined);
    assert.ok(
      Math.abs(probe.durationSeconds - 3) < 0.5,
      `expected ~3s, got ${probe.durationSeconds}`,
    );
  });

  it("reports an over-length video's true length rather than its claimed one", async () => {
    const probe = await client.probe(fixture("video-too-long.mp4"));

    assert.ok(probe.durationSeconds !== undefined);
    assert.ok(probe.durationSeconds > 90, `expected over 90s, got ${probe.durationSeconds}`);
  });

  it("makes nothing of a file that is not media", async () => {
    // A PDF renamed to .jpg. ffprobe recognises the extension enough to try,
    // and comes back with no dimensions — which is how "there is nothing here"
    // presents itself.
    const probe = await client.probe(fixture("not-really-a-photo.jpg"));

    assert.ok(
      probe.width === undefined || probe.width === 0,
      "a file with no picture in it must not report dimensions",
    );
  });
});

describe("probing, then judging", () => {
  it("accepts a genuine photograph", async () => {
    const verdict = checkMedia(await client.probe(fixture("photo.jpg")), "image");

    assert.ok(verdict.ok, `expected acceptance, got ${JSON.stringify(verdict)}`);
    assert.equal(verdict.kind, "image");
  });

  it("accepts a genuine video", async () => {
    const verdict = checkMedia(await client.probe(fixture("video-short.mp4")), "video");

    assert.ok(verdict.ok);
    assert.equal(verdict.kind, "video");
  });

  it("refuses a video over ninety seconds", async () => {
    const verdict = checkMedia(await client.probe(fixture("video-too-long.mp4")), "video");

    assert.deepEqual(verdict, { ok: false, reason: "too_long" });
  });

  it("refuses a PDF wearing a photograph's name", async () => {
    // The hole the previous sub-phase documented and could not close: the
    // uploader declared an image consistently, and only opening the file
    // settles it.
    const verdict = checkMedia(await client.probe(fixture("not-really-a-photo.jpg")), "image");

    assert.equal(verdict.ok, false);
  });

  it("refuses a real video uploaded as a photograph", async () => {
    const verdict = checkMedia(await client.probe(fixture("video-short.mp4")), "image");

    assert.deepEqual(verdict, { ok: false, reason: "kind_mismatch" });
  });

  it("refuses a real photograph uploaded as a video", async () => {
    const verdict = checkMedia(await client.probe(fixture("photo.jpg")), "video");

    assert.deepEqual(verdict, { ok: false, reason: "kind_mismatch" });
  });
});
