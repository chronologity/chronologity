import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  checkMedia,
  classifyMediaRejection,
  classifyProcessingError,
  describeMediaRejection,
  MAXIMUM_VIDEO_SECONDS,
  type MediaRejection,
  type ProbedMedia,
  acceptedContentTypes,
  inferMediaKind,
} from "./upload.media-policy.js";

const image = (over: Partial<ProbedMedia> = {}): ProbedMedia => ({
  formats: ["image2"],
  codec: "mjpeg",
  durationSeconds: undefined,
  width: 1920,
  height: 1080,
  hasAudio: false,
  hasMotion: false,
  ...over,
});

const video = (over: Partial<ProbedMedia> = {}): ProbedMedia => ({
  formats: ["mov", "mp4", "m4a"],
  codec: "h264",
  durationSeconds: 12,
  width: 1920,
  height: 1080,
  hasAudio: true,
  hasMotion: true,
  ...over,
});

describe("checkMedia — what the file actually is", () => {
  it("accepts a real photo declared as a photo", () => {
    assert.deepEqual(checkMedia(image(), "image"), {
      ok: true,
      kind: "image",
      codec: "mjpeg",
      container: "image2",
      width: 1920,
      height: 1080,
      durationSeconds: undefined,
    });
  });

  it("accepts a real video declared as a video", () => {
    assert.deepEqual(checkMedia(video(), "video"), {
      ok: true,
      kind: "video",
      codec: "h264",
      // The first the decoder named, not all of them: one file is stored once.
      container: "mov",
      width: 1920,
      height: 1080,
      durationSeconds: 12,
    });
  });

  it("refuses a file the decoder made nothing of", () => {
    // A PDF renamed to .jpg and declared as a photo lands here. This is the
    // hole the previous sub-phase documented and could not close.
    const notMedia = image({ formats: [], codec: undefined });

    assert.deepEqual(checkMedia(notMedia, "image"), { ok: false, reason: "not_media" });
  });

  it("refuses a container with no codec inside it", () => {
    assert.deepEqual(checkMedia(video({ codec: undefined }), "video"), {
      ok: false,
      reason: "not_media",
    });
  });

  it("refuses a video uploaded as a photo", () => {
    assert.deepEqual(checkMedia(video(), "image"), { ok: false, reason: "kind_mismatch" });
  });

  it("refuses a photo uploaded as a video", () => {
    assert.deepEqual(checkMedia(image(), "video"), { ok: false, reason: "kind_mismatch" });
  });

  it("decides what a file is by whether it moves, not by what it was called", () => {
    // A single-frame MP4 is a video container holding no motion. It is a
    // picture, whatever the extension says.
    const stillInVideoContainer = video({ hasMotion: false, codec: "mjpeg", durationSeconds: 0 });

    assert.deepEqual(checkMedia(stillInVideoContainer, "image"), {
      ok: true,
      kind: "image",
      codec: "mjpeg",
      container: "mov",
      width: 1920,
      height: 1080,
      // A still has no length, whatever container it arrived in.
      durationSeconds: undefined,
    });
  });
});

describe("checkMedia — the ninety-second limit", () => {
  it("accepts a video of exactly the limit", () => {
    // The boundary belongs to the video sitting on it.
    const decision = checkMedia(video({ durationSeconds: MAXIMUM_VIDEO_SECONDS }), "video");

    assert.ok(decision.ok);
    assert.equal(decision.durationSeconds, 90);
  });

  it("refuses a video a fraction over the limit", () => {
    assert.deepEqual(checkMedia(video({ durationSeconds: 90.04 }), "video"), {
      ok: false,
      reason: "too_long",
    });
  });

  it("refuses a plainly over-length video", () => {
    assert.deepEqual(checkMedia(video({ durationSeconds: 94 }), "video"), {
      ok: false,
      reason: "too_long",
    });
  });

  it("honours a limit passed in, so the rule is not hard-wired", () => {
    assert.ok(checkMedia(video({ durationSeconds: 120 }), "video", 180).ok);
    assert.deepEqual(checkMedia(video({ durationSeconds: 120 }), "video", 60), {
      ok: false,
      reason: "too_long",
    });
  });

  it("refuses a video whose length could not be read", () => {
    // Admitting it would mean admitting a video of unknown length, which is
    // exactly what the limit exists to prevent.
    assert.deepEqual(checkMedia(video({ durationSeconds: undefined }), "video"), {
      ok: false,
      reason: "unknown_duration",
    });
  });

  it("refuses a video reporting an infinite length", () => {
    assert.deepEqual(checkMedia(video({ durationSeconds: Number.POSITIVE_INFINITY }), "video"), {
      ok: false,
      reason: "unknown_duration",
    });
  });

  it("does not apply the limit to photographs", () => {
    assert.ok(checkMedia(image({ durationSeconds: 3600 }), "image").ok);
  });
});

describe("checkMedia — formats and dimensions", () => {
  it("refuses an image codec the product does not store", () => {
    assert.deepEqual(checkMedia(image({ codec: "gif" }), "image"), {
      ok: false,
      reason: "unsupported_codec",
    });
  });

  it("refuses a video codec the product does not store", () => {
    assert.deepEqual(checkMedia(video({ codec: "wmv3" }), "video"), {
      ok: false,
      reason: "unsupported_codec",
    });
  });

  it("refuses a file with no dimensions", () => {
    for (const over of [{ width: undefined }, { height: undefined }, { width: 0 }, { height: 0 }]) {
      assert.deepEqual(checkMedia(image(over), "image"), { ok: false, reason: "no_dimensions" });
    }
  });

  it("checks what a file is before checking its codec", () => {
    // Ordering matters: a video uploaded as a photo should be told it is the
    // wrong kind, not that its codec is unsupported.
    assert.deepEqual(checkMedia(video({ codec: "wmv3" }), "image"), {
      ok: false,
      reason: "kind_mismatch",
    });
  });
});

describe("describeMediaRejection", () => {
  it("states the limit, because that one is public policy", () => {
    // Unlike the minimum age, telling someone their video is too long is
    // useless without saying how long is allowed.
    assert.match(describeMediaRejection("too_long"), /90 seconds/);
    assert.match(describeMediaRejection("too_long", 30), /30 seconds/);
  });

  it("describes the file rather than the machinery", () => {
    for (const reason of [
      "not_media",
      "kind_mismatch",
      "unsupported_codec",
      "no_dimensions",
      "unknown_duration",
      "too_long",
    ] as const) {
      const message = describeMediaRejection(reason);

      assert.ok(message.length > 0, reason);
      assert.doesNotMatch(message, /codec_|probe|ffprobe|stream|error|null|undefined/i, reason);
    }
  });
});

describe("classifyMediaRejection", () => {
  it("treats every judgement about a file's contents as permanent", () => {
    // A 94-second video will be 94 seconds long forever.
    for (const reason of [
      "not_media",
      "kind_mismatch",
      "unsupported_codec",
      "no_dimensions",
      "unknown_duration",
      "too_long",
    ] as MediaRejection[]) {
      assert.equal(classifyMediaRejection(reason), "permanent", reason);
    }
  });
});

describe("classifyProcessingError", () => {
  it("retries the failures that pass on their own", () => {
    const transient = [
      Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }),
      new Error("socket hang up"),
      new Error("ffprobe timed out"),
      new Error("Service Unavailable"),
      new Error("We encountered an internal error: InternalError"),
    ];

    for (const error of transient) {
      assert.equal(classifyProcessingError(error), "transient", error.message);
    }
  });

  it("gives up on anything it does not recognise", () => {
    // The cautious direction: retrying forever hides the fault, while stopping
    // leaves a recorded reason someone can act on.
    for (const error of [
      new Error("Invalid data found when processing input"),
      new Error("moov atom not found"),
      new Error("Permission denied"),
      "a string that is not an Error",
      undefined,
    ]) {
      assert.equal(classifyProcessingError(error), "permanent", String(error));
    }
  });

  it("matches on the error code as well as the message", () => {
    assert.equal(
      classifyProcessingError(Object.assign(new Error("failed"), { code: "EAI_AGAIN" })),
      "transient",
    );
  });
});

describe("inferMediaKind", () => {
  it("classifies the image formats", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/avif"]) {
      assert.equal(inferMediaKind(type), "image", type);
    }
  });

  it("classifies the video formats", () => {
    for (const type of ["video/mp4", "video/quicktime", "video/webm"]) {
      assert.equal(inferMediaKind(type), "video", type);
    }
  });

  it("ignores parameters and casing, which vary between clients", () => {
    assert.equal(inferMediaKind("IMAGE/JPEG"), "image");
    assert.equal(inferMediaKind("image/jpeg; charset=binary"), "image");
    assert.equal(inferMediaKind("  image/jpeg  "), "image");
  });

  it("refuses SVG, which executes script rather than being a picture", () => {
    assert.equal(inferMediaKind("image/svg+xml"), undefined);
  });

  it("refuses anything outside the allowlist", () => {
    for (const type of [
      "application/pdf",
      "text/html",
      "application/octet-stream",
      "image/gif",
      "video/x-msvideo",
      "",
      "image",
      "image/",
    ]) {
      assert.equal(inferMediaKind(type), undefined, type);
    }
  });

  it("does not accept a type merely for starting with image/", () => {
    // A prefix test would admit every present and future image type,
    // including ones nothing here can decode.
    assert.equal(inferMediaKind("image/x-icon"), undefined);
    assert.equal(inferMediaKind("image/tiff"), undefined);
  });
});

describe("acceptedContentTypes", () => {
  it("lists every type inferMediaKind accepts", () => {
    for (const type of acceptedContentTypes()) {
      assert.notEqual(inferMediaKind(type), undefined, type);
    }
  });

  it("is not empty, since the message it builds would say nothing", () => {
    assert.ok(acceptedContentTypes().length > 0);
  });
});
