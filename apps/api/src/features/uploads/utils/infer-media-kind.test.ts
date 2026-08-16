import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { acceptedContentTypes, inferMediaKind } from "./infer-media-kind.js";
import { originalKey } from "./storage-key.js";

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

describe("originalKey", () => {
  it("puts the owner in the path, so an object traces to an account", () => {
    assert.equal(originalKey("user-1", "upload-1"), "uploads/user-1/upload-1/original");
  });

  it("differs per upload, so one cannot overwrite another", () => {
    assert.notEqual(originalKey("user-1", "upload-1"), originalKey("user-1", "upload-2"));
  });

  it("differs per owner for the same upload identifier", () => {
    assert.notEqual(originalKey("user-1", "upload-1"), originalKey("user-2", "upload-1"));
  });
});
