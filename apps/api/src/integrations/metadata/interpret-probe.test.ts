import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { empty, hasMotion, interpret, isTimeoutOrMissing, toSeconds } from "./interpret-probe.js";

/**
 * Reading a decoder's report.
 *
 * These need no decoder, no files, and no infrastructure — which is the point.
 * The first version of `hasMotion` classified every photograph as a video, and
 * that was found by an integration test needing ffmpeg, real fixtures and
 * several seconds. The logic is plain reasoning over a plain object; it should
 * fail here first, instantly.
 */

const report = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    format: { format_name: "mov,mp4,m4a", duration: "12.5" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, nb_frames: "300" },
    ],
    ...over,
  });

describe("interpret", () => {
  it("reads a video's report", () => {
    const probe = interpret(report());

    assert.deepEqual(probe.formats, ["mov", "mp4", "m4a"]);
    assert.equal(probe.codec, "h264");
    assert.equal(probe.durationSeconds, 12.5);
    assert.equal(probe.width, 1920);
    assert.equal(probe.height, 1080);
    assert.equal(probe.hasMotion, true);
  });

  it("notices sound", () => {
    const withAudio = interpret(
      report({
        streams: [
          { codec_type: "video", codec_name: "h264", width: 10, height: 10, nb_frames: "30" },
          { codec_type: "audio", codec_name: "aac" },
        ],
      }),
    );

    assert.equal(withAudio.hasAudio, true);
    assert.equal(interpret(report()).hasAudio, false);
  });

  it("makes nothing of a report it cannot parse", () => {
    // A decoder that produced gibberish has told us the same thing as one that
    // produced nothing.
    for (const nonsense of ["", "not json", "{", "null"]) {
      assert.deepEqual(interpret(nonsense), empty(), nonsense);
    }
  });

  it("makes nothing of a report with no picture in it", () => {
    const audioOnly = report({ streams: [{ codec_type: "audio", codec_name: "mp3" }] });

    assert.deepEqual(interpret(audioOnly), empty());
  });

  it("falls back to the stream's own duration when the container has none", () => {
    const streamDuration = report({
      format: { format_name: "mov,mp4,m4a" },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 10,
          height: 10,
          nb_frames: "30",
          duration: "7.25",
        },
      ],
    });

    assert.equal(interpret(streamDuration).durationSeconds, 7.25);
  });

  it("reports no duration rather than a wrong one", () => {
    const unknown = report({
      format: { format_name: "mov,mp4,m4a", duration: "N/A" },
      streams: [{ codec_type: "video", codec_name: "h264", width: 10, height: 10 }],
    });

    assert.equal(interpret(unknown).durationSeconds, undefined);
  });
});

describe("hasMotion — telling a photograph from a film", () => {
  const still = { codec_type: "video", codec_name: "mjpeg", width: 640, height: 480 };

  it("treats a still-image format as still, whatever its nominal duration", () => {
    // The bug this exists to prevent. ffprobe reports a single JPEG as lasting
    // 0.04 seconds, because it assumes 25 frames a second and one frame is a
    // twenty-fifth of a second. Reading that as motion made every photograph a
    // video.
    assert.equal(hasMotion(["image2"], still, 0.04), false);
  });

  it("treats every still-image format the same way", () => {
    for (const format of ["image2", "png_pipe", "jpeg_pipe", "mjpeg", "webp_pipe", "bmp_pipe"]) {
      assert.equal(hasMotion([format], still, 0.04), false, format);
    }
  });

  it("treats a real video as moving", () => {
    assert.equal(hasMotion(["mov", "mp4"], { ...still, nb_frames: "300" }, 12), true);
  });

  it("treats a single frame in a video container as still", () => {
    assert.equal(hasMotion(["mov", "mp4"], { ...still, nb_frames: "1" }, 0), false);
  });

  it("falls back to duration when the frame count is missing", () => {
    assert.equal(hasMotion(["mov", "mp4"], still, 12), true);
    assert.equal(hasMotion(["mov", "mp4"], still, 0), false);
    assert.equal(hasMotion(["mov", "mp4"], still, undefined), false);
  });

  it("prefers the frame count over the duration when both exist", () => {
    // A long file holding one frame is a picture someone left running.
    assert.equal(hasMotion(["mov", "mp4"], { ...still, nb_frames: "1" }, 3600), false);
  });

  it("ignores an unreadable frame count", () => {
    assert.equal(hasMotion(["mov", "mp4"], { ...still, nb_frames: "N/A" }, 12), true);
  });
});

describe("toSeconds", () => {
  it("reads a duration", () => {
    assert.equal(toSeconds("12.5"), 12.5);
    assert.equal(toSeconds("0"), 0);
  });

  it("reports nothing rather than a wrong number", () => {
    // ffprobe writes "N/A" for a duration it could not establish. Reading that
    // as zero would make an unmeasurable video look instantaneous, and it
    // would pass the ninety-second limit.
    for (const value of [undefined, "N/A", "", "unknown"]) {
      assert.equal(toSeconds(value), undefined, String(value));
    }
  });
});

describe("isTimeoutOrMissing — a fault, not a verdict", () => {
  it("recognises a decoder that is not installed", () => {
    assert.equal(isTimeoutOrMissing({ code: "ENOENT" }), true);
  });

  it("recognises a decoder that ran too long", () => {
    assert.equal(isTimeoutOrMissing({ killed: true }), true);
    assert.equal(isTimeoutOrMissing({ signal: "SIGTERM" }), true);
    assert.equal(isTimeoutOrMissing({ code: "ETIMEDOUT" }), true);
  });

  it("does not mistake a refused file for a broken decoder", () => {
    // A decoder exiting non-zero on rubbish is answering the question. Treating
    // that as a fault would retry a file that will never decode.
    for (const error of [{ code: 1 }, { code: 234 }, new Error("Invalid data"), {}, null]) {
      assert.equal(isTimeoutOrMissing(error), false, JSON.stringify(error));
    }
  });
});
