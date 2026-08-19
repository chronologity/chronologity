import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  derivativesFor,
  hasAllDerivatives,
  missingDerivatives,
  withProduced,
} from "./upload.derivative-policy.js";
import {
  derivativeContentType,
  derivativeKey,
  originalKey,
  uploadPrefix,
} from "./upload.storage-key.js";

describe("derivativesFor", () => {
  it("gives a photograph a preview", () => {
    assert.deepEqual(derivativesFor("image"), ["thumbnail"]);
  });

  it("gives a video a still frame and a copy that starts immediately", () => {
    assert.deepEqual(derivativesFor("video"), ["poster", "faststart"]);
  });

  it("does not give a photograph a video derivative", () => {
    const forImage = derivativesFor("image");

    assert.ok(!forImage.includes("faststart"));
    assert.ok(!forImage.includes("poster"));
  });

  it("does not give a video a thumbnail, since its poster serves that purpose", () => {
    assert.ok(!derivativesFor("video").includes("thumbnail"));
  });
});

describe("hasAllDerivatives", () => {
  it("is satisfied when a photograph has its preview", () => {
    assert.equal(hasAllDerivatives("image", ["thumbnail"]), true);
  });

  it("is satisfied when a video has both of its derivatives", () => {
    assert.equal(hasAllDerivatives("video", ["poster", "faststart"]), true);
  });

  it("is not satisfied when a video has only one", () => {
    // Reachable when processing failed partway. The remaining work should
    // happen rather than the upload being treated as finished.
    assert.equal(hasAllDerivatives("video", ["poster"]), false);
    assert.equal(hasAllDerivatives("video", ["faststart"]), false);
  });

  it("is not satisfied when nothing has been produced", () => {
    assert.equal(hasAllDerivatives("image", []), false);
    assert.equal(hasAllDerivatives("video", []), false);
  });

  it("ignores derivatives that are not needed", () => {
    // A thumbnail against a video says nothing about whether the video is done.
    assert.equal(hasAllDerivatives("video", ["thumbnail"]), false);
    assert.equal(hasAllDerivatives("image", ["thumbnail", "poster"]), true);
  });
});

describe("where derivatives are stored", () => {
  const owner = "user-1";
  const upload = "upload-1";

  it("keeps every file for an upload under one prefix", () => {
    // What makes deletion a listing rather than a list of key shapes that has
    // to be kept in step with whatever the code writes.
    const prefix = uploadPrefix(owner, upload);

    for (const key of [
      originalKey(owner, upload),
      derivativeKey(owner, upload, "thumbnail"),
      derivativeKey(owner, upload, "poster"),
      derivativeKey(owner, upload, "faststart"),
    ]) {
      assert.ok(key.startsWith(`${prefix}/`), key);
    }
  });

  it("gives each derivative its own key", () => {
    const keys = (["thumbnail", "poster", "faststart"] as const).map((kind) =>
      derivativeKey(owner, upload, kind),
    );

    assert.equal(new Set(keys).size, keys.length);
  });

  it("never collides with the original", () => {
    for (const kind of ["thumbnail", "poster", "faststart"] as const) {
      assert.notEqual(derivativeKey(owner, upload, kind), originalKey(owner, upload));
    }
  });

  it("separates one upload's derivatives from another's", () => {
    assert.notEqual(
      derivativeKey(owner, "upload-1", "thumbnail"),
      derivativeKey(owner, "upload-2", "thumbnail"),
    );
    assert.notEqual(
      derivativeKey("user-1", upload, "thumbnail"),
      derivativeKey("user-2", upload, "thumbnail"),
    );
  });

  it("declares an honest media type for each derivative", () => {
    // Set by us rather than declared by anyone, so unlike an uploaded file's
    // content type this one can be trusted.
    assert.equal(derivativeContentType("thumbnail"), "image/jpeg");
    assert.equal(derivativeContentType("poster"), "image/jpeg");
    assert.equal(derivativeContentType("faststart"), "video/mp4");
  });
});

describe("missingDerivatives", () => {
  it("wants everything when nothing exists yet", () => {
    assert.deepEqual(missingDerivatives("image", []), ["thumbnail"]);
    assert.deepEqual(missingDerivatives("video", []), ["poster", "faststart"]);
  });

  it("wants only what is absent after a partial failure", () => {
    // The case this exists for. A video whose poster was made but whose
    // faststart copy failed must not be transcoded from scratch on retry.
    assert.deepEqual(missingDerivatives("video", ["poster"]), ["faststart"]);
  });

  it("wants nothing once everything exists", () => {
    assert.deepEqual(missingDerivatives("image", ["thumbnail"]), []);
    assert.deepEqual(missingDerivatives("video", ["poster", "faststart"]), []);
  });

  it("ignores derivatives that do not belong to this kind", () => {
    // A row carrying a derivative from a kind it is not is stale data rather
    // than a reason to refuse: what matters is that the wanted ones exist.
    assert.deepEqual(missingDerivatives("image", ["poster", "faststart"]), ["thumbnail"]);
  });
});

describe("withProduced", () => {
  it("keeps what already existed", () => {
    // A second pass that produced only the missing derivative must not report
    // that as the complete set.
    assert.deepEqual(withProduced(["poster"], ["faststart"]), ["poster", "faststart"]);
  });

  it("does not duplicate a derivative produced twice", () => {
    assert.deepEqual(withProduced(["thumbnail"], ["thumbnail"]), ["thumbnail"]);
  });

  it("handles a first pass with nothing before it", () => {
    assert.deepEqual(withProduced([], ["thumbnail"]), ["thumbnail"]);
  });

  it("keeps everything when a pass produced nothing", () => {
    assert.deepEqual(withProduced(["poster", "faststart"], []), ["poster", "faststart"]);
  });
});
