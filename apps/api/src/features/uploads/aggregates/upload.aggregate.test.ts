import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  decideCheck,
  decideDelete,
  decideDerivativesProduced,
  decideFail,
  decideFinalize,
  decideRegister,
  evolveUpload,
  initialUploadState,
  type UploadEvent,
  type UploadState,
} from "./upload.aggregate.js";

const OWNER = "owner-1";
const OTHER = "someone-else";
const now = new Date("2026-08-16T12:00:00.000Z");
const later = new Date("2026-08-16T14:00:00.000Z");

const registered = (expiresAt = later): UploadEvent => ({
  type: "UploadRegistered",
  payload: {
    uploadId: "u1",
    ownerUserId: OWNER,
    kind: "image",
    declaredContentType: "image/jpeg",
    declaredByteSize: 1024,
    storageKey: "uploads/owner-1/u1/original",
    registeredAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  },
});

/** The identity every UploadReceived now repeats from registration. */
const identity = {
  uploadId: "u1",
  ownerUserId: OWNER,
  kind: "image" as const,
  storageKey: "uploads/owner-1/u1/original",
};

const stateAfter = (...events: UploadEvent[]): UploadState =>
  events.reduce(evolveUpload, initialUploadState);

describe("evolveUpload", () => {
  it("starts absent", () => {
    assert.equal(initialUploadState.exists, false);
  });

  it("records everything registration establishes", () => {
    const state = stateAfter(registered());

    assert.equal(state.exists, true);
    assert.equal(state.ownerUserId, OWNER);
    assert.equal(state.kind, "image");
    assert.equal(state.declaredContentType, "image/jpeg");
    assert.equal(state.declaredByteSize, 1024);
    assert.equal(state.status, "registered");
  });

  it("moves to received", () => {
    const state = stateAfter(registered(), {
      type: "UploadReceived",
      payload: {
        ...identity,
        byteSize: 2048,
        contentType: "image/jpeg",
        checksum: "abc",
        receivedAt: now.toISOString(),
      },
    });

    assert.equal(state.status, "received");
  });

  it("moves to failed", () => {
    const state = stateAfter(registered(), {
      type: "UploadFailed",
      payload: {
        reason: "too large",
        category: "permanent",
        attempt: 1,
        failedAt: now.toISOString(),
      },
    });

    assert.equal(state.status, "failed");
  });

  it("moves to deleted", () => {
    const state = stateAfter(registered(), {
      type: "UploadDeleted",
      payload: { deletedAt: now.toISOString() },
    });

    assert.equal(state.status, "deleted");
  });

  it("ignores event types it does not recognise", () => {
    const state = evolveUpload(initialUploadState, {
      type: "SomethingElse",
      payload: {},
    } as unknown as UploadEvent);

    assert.equal(state, initialUploadState);
  });
});

describe("decideRegister", () => {
  const input = {
    uploadId: "u1",
    ownerUserId: OWNER,
    kind: "image" as const,
    declaredContentType: "image/jpeg",
    declaredByteSize: 1024,
    storageKey: "uploads/owner-1/u1/original",
    expiresAt: later,
    now,
  };

  it("authorises a new upload", () => {
    const decision = decideRegister(initialUploadState, input);

    assert.ok(decision.ok);
    assert.equal(decision.events[0]?.type, "UploadRegistered");
  });

  it("records the storage key, so it is never recomputed", () => {
    const decision = decideRegister(initialUploadState, input);

    assert.ok(decision.ok);
    const event = decision.events[0];
    assert.equal(event?.type, "UploadRegistered");
    assert.equal(event.payload.storageKey, "uploads/owner-1/u1/original");
  });

  it("refuses to register over an existing upload", () => {
    const decision = decideRegister(stateAfter(registered()), input);

    assert.deepEqual(decision, { ok: false, reason: "upload_already_exists" });
  });
});

describe("decideFinalize", () => {
  const input = {
    actorUserId: OWNER,
    byteSize: 2048,
    contentType: "image/jpeg",
    checksum: "abc",
    now,
  };

  it("accepts an upload whose object has arrived", () => {
    const decision = decideFinalize(stateAfter(registered()), input);

    assert.ok(decision.ok);
    assert.equal(decision.events[0]?.type, "UploadReceived");
  });

  it("says which object arrived, so the event can be read on its own", () => {
    const decision = decideFinalize(stateAfter(registered()), input);

    assert.ok(decision.ok);

    const event = decision.events[0];

    assert.equal(event?.type, "UploadReceived");
    assert.equal(event.payload.uploadId, "u1");
    assert.equal(event.payload.ownerUserId, OWNER);
    assert.equal(event.payload.storageKey, "uploads/owner-1/u1/original");
  });

  it("records what storage reported, not what was declared", () => {
    const decision = decideFinalize(stateAfter(registered()), input);

    assert.ok(decision.ok);
    const event = decision.events[0];
    assert.equal(event?.type, "UploadReceived");
    // Registration declared 1024; storage reported 2048. The latter wins.
    assert.equal(event.payload.byteSize, 2048);
  });

  it("refuses someone else's upload", () => {
    const decision = decideFinalize(stateAfter(registered()), {
      ...input,
      actorUserId: OTHER,
    });

    assert.deepEqual(decision, { ok: false, reason: "not_owner" });
  });

  it("refuses an upload that does not exist", () => {
    assert.deepEqual(decideFinalize(initialUploadState, input), {
      ok: false,
      reason: "upload_not_found",
    });
  });

  it("treats a deleted upload as absent, even for its owner", () => {
    const state = stateAfter(registered(), {
      type: "UploadDeleted",
      payload: { deletedAt: now.toISOString() },
    });

    assert.deepEqual(decideFinalize(state, input), { ok: false, reason: "upload_not_found" });
  });

  it("refuses a lapsed registration", () => {
    const expired = stateAfter(registered(new Date("2026-08-16T11:00:00.000Z")));

    assert.deepEqual(decideFinalize(expired, input), {
      ok: false,
      reason: "registration_expired",
    });
  });

  it("treats the expiry instant itself as lapsed", () => {
    const boundary = stateAfter(registered(now));

    assert.deepEqual(decideFinalize(boundary, input), {
      ok: false,
      reason: "registration_expired",
    });
  });

  it("refuses to receive the same upload twice", () => {
    const state = stateAfter(registered(), {
      type: "UploadReceived",
      payload: {
        ...identity,
        byteSize: 2048,
        contentType: "image/jpeg",
        checksum: "abc",
        receivedAt: now.toISOString(),
      },
    });

    assert.deepEqual(decideFinalize(state, input), { ok: false, reason: "already_received" });
  });

  it("refuses to receive an upload already failed", () => {
    const state = stateAfter(registered(), {
      type: "UploadFailed",
      payload: {
        reason: "too large",
        category: "permanent",
        attempt: 1,
        failedAt: now.toISOString(),
      },
    });

    assert.deepEqual(decideFinalize(state, input), { ok: false, reason: "already_failed" });
  });

  it("checks ownership before expiry, so a stranger learns nothing about timing", () => {
    const expired = stateAfter(registered(new Date("2026-08-16T11:00:00.000Z")));

    assert.deepEqual(decideFinalize(expired, { ...input, actorUserId: OTHER }), {
      ok: false,
      reason: "not_owner",
    });
  });
});

describe("decideFail", () => {
  const input = {
    actorUserId: OWNER,
    reason: "That file is larger than the limit",
    category: "permanent" as const,
    attempt: 1,
    now,
  };

  it("refuses an upload", () => {
    const decision = decideFail(stateAfter(registered()), input);

    assert.ok(decision.ok);
    assert.equal(decision.events[0]?.type, "UploadFailed");
  });

  it("can fail an upload that was already received", () => {
    // Reachable in 5E-2: decoding may reject media that arrived intact.
    const state = stateAfter(registered(), {
      type: "UploadReceived",
      payload: {
        ...identity,
        byteSize: 2048,
        contentType: "image/jpeg",
        checksum: "abc",
        receivedAt: now.toISOString(),
      },
    });

    assert.ok(decideFail(state, input).ok);
  });

  it("refuses to fail the same upload twice", () => {
    const state = stateAfter(registered(), {
      type: "UploadFailed",
      payload: {
        reason: "too large",
        category: "permanent",
        attempt: 1,
        failedAt: now.toISOString(),
      },
    });

    assert.deepEqual(decideFail(state, input), { ok: false, reason: "already_failed" });
  });

  it("refuses someone else's upload", () => {
    assert.deepEqual(decideFail(stateAfter(registered()), { ...input, actorUserId: OTHER }), {
      ok: false,
      reason: "not_owner",
    });
  });
});

describe("decideDelete", () => {
  const input = { actorUserId: OWNER, now };

  it("deletes an upload", () => {
    const decision = decideDelete(stateAfter(registered()), input);

    assert.ok(decision.ok);
    assert.equal(decision.events[0]?.type, "UploadDeleted");
  });

  it("deletes a received upload", () => {
    const state = stateAfter(registered(), {
      type: "UploadReceived",
      payload: {
        ...identity,
        byteSize: 2048,
        contentType: "image/jpeg",
        checksum: "abc",
        receivedAt: now.toISOString(),
      },
    });

    assert.ok(decideDelete(state, input).ok);
  });

  it("reports a deleted upload as absent rather than as already deleted", () => {
    // The ownership guard runs first and treats deleted as gone, which makes
    // `already_deleted` unreachable here. Callers that want idempotent
    // deletion must check the state themselves, and the handler does.
    const state = stateAfter(registered(), {
      type: "UploadDeleted",
      payload: { deletedAt: now.toISOString() },
    });

    assert.deepEqual(decideDelete(state, input), { ok: false, reason: "upload_not_found" });
  });

  it("refuses someone else's upload", () => {
    assert.deepEqual(decideDelete(stateAfter(registered()), { ...input, actorUserId: OTHER }), {
      ok: false,
      reason: "not_owner",
    });
  });
});

describe("decideCheck", () => {
  const measured = {
    kind: "image" as const,
    codec: "mjpeg",
    container: "image2",
    width: 640,
    height: 480,
    durationSeconds: undefined,
    hasAudio: false,
    now,
  };

  const arrived = () =>
    stateAfter(registered(), {
      type: "UploadReceived",
      payload: {
        ...identity,
        byteSize: 2048,
        contentType: "image/jpeg",
        checksum: "abc",
        receivedAt: now.toISOString(),
      },
    });

  it("accepts a file that arrived and was opened", () => {
    const decision = decideCheck(arrived(), measured);

    assert.ok(decision.ok);
    assert.equal(decision.events[0]?.type, "UploadChecked");
  });

  it("records what was measured rather than what was declared", () => {
    // Registration declared an image; so did the decoder. The point is that
    // the recorded kind comes from the second one.
    const decision = decideCheck(arrived(), { ...measured, kind: "video", durationSeconds: 12 });

    assert.ok(decision.ok);

    const event = decision.events[0];

    assert.equal(event?.type, "UploadChecked");
    assert.equal(event.payload.kind, "video");
    assert.equal(event.payload.durationSeconds, 12);
  });

  it("refuses a file that never arrived", () => {
    // A note delivered before the arrival it describes. There is nothing to
    // open.
    assert.deepEqual(decideCheck(stateAfter(registered()), measured), {
      ok: false,
      reason: "not_received",
    });
  });

  it("refuses an upload that does not exist", () => {
    assert.deepEqual(decideCheck(initialUploadState, measured), {
      ok: false,
      reason: "upload_not_found",
    });
  });

  it("treats a deleted upload as absent", () => {
    const deleted = stateAfter(registered(), {
      type: "UploadDeleted",
      payload: { deletedAt: now.toISOString() },
    });

    assert.deepEqual(decideCheck(deleted, measured), { ok: false, reason: "upload_not_found" });
  });

  it("refuses to check the same file twice", () => {
    // At-least-once delivery makes this ordinary. Callers treat it as success.
    const checked = stateAfter(
      registered(),
      {
        type: "UploadReceived",
        payload: {
          ...identity,
          byteSize: 2048,
          contentType: "image/jpeg",
          checksum: "abc",
          receivedAt: now.toISOString(),
        },
      },
      {
        type: "UploadChecked",
        payload: { ...measured, checkedAt: now.toISOString() },
      },
    );

    assert.deepEqual(decideCheck(checked, measured), { ok: false, reason: "already_checked" });
  });

  it("refuses to check a file already refused", () => {
    const failed = stateAfter(registered(), {
      type: "UploadFailed",
      payload: {
        reason: "too large",
        category: "permanent",
        attempt: 1,
        failedAt: now.toISOString(),
      },
    });

    assert.deepEqual(decideCheck(failed, measured), { ok: false, reason: "already_failed" });
  });

  it("replaces the declared kind with the measured one in state", () => {
    const decision = decideCheck(arrived(), { ...measured, kind: "video", durationSeconds: 3 });

    assert.ok(decision.ok);

    const after = stateAfter(
      registered(),
      {
        type: "UploadReceived",
        payload: {
          ...identity,
          byteSize: 2048,
          contentType: "image/jpeg",
          checksum: "abc",
          receivedAt: now.toISOString(),
        },
      },
      decision.events[0]!,
    );

    assert.equal(after.status, "ready");
    assert.equal(after.kind, "video");
  });
});

describe("decideDerivativesProduced", () => {
  const ready = () =>
    stateAfter(registered(), {
      type: "UploadReceived",
      payload: {
        ...identity,
        byteSize: 2048,
        contentType: "image/jpeg",
        checksum: "abc",
        receivedAt: now.toISOString(),
      },
    });

  it("records what was produced", () => {
    const decision = decideDerivativesProduced(ready(), { derivatives: ["thumbnail"], now });

    assert.ok(decision.ok);
    assert.equal(decision.events[0]?.type, "UploadDerivativesProduced");
  });

  it("records only what is new", () => {
    // A second pass after a partial failure should add what was missing rather
    // than claiming to have produced everything again.
    const withPoster = stateAfter(
      registered(),
      {
        type: "UploadReceived",
        payload: {
          ...identity,
          byteSize: 2048,
          contentType: "video/mp4",
          checksum: "abc",
          receivedAt: now.toISOString(),
        },
      },
      {
        type: "UploadDerivativesProduced",
        payload: { derivatives: ["poster"], producedAt: now.toISOString() },
      },
    );

    const decision = decideDerivativesProduced(withPoster, {
      derivatives: ["poster", "faststart"],
      now,
    });

    assert.ok(decision.ok);

    const event = decision.events[0];

    assert.equal(event?.type, "UploadDerivativesProduced");
    assert.deepEqual(event.payload.derivatives, ["faststart"]);
  });

  it("refuses when nothing is new", () => {
    // History should say what happened, and a worker running again did not
    // produce anything.
    const withThumbnail = stateAfter(
      registered(),
      {
        type: "UploadReceived",
        payload: {
          ...identity,
          byteSize: 2048,
          contentType: "image/jpeg",
          checksum: "abc",
          receivedAt: now.toISOString(),
        },
      },
      {
        type: "UploadDerivativesProduced",
        payload: { derivatives: ["thumbnail"], producedAt: now.toISOString() },
      },
    );

    assert.deepEqual(
      decideDerivativesProduced(withThumbnail, { derivatives: ["thumbnail"], now }),
      { ok: false, reason: "nothing_to_produce" },
    );
  });

  it("accumulates rather than replacing", () => {
    const first = stateAfter(
      registered(),
      {
        type: "UploadDerivativesProduced",
        payload: { derivatives: ["poster"], producedAt: now.toISOString() },
      },
      {
        type: "UploadDerivativesProduced",
        payload: { derivatives: ["faststart"], producedAt: now.toISOString() },
      },
    );

    assert.deepEqual([...first.derivatives].sort(), ["faststart", "poster"]);
  });

  it("refuses for an upload that does not exist", () => {
    assert.deepEqual(
      decideDerivativesProduced(initialUploadState, { derivatives: ["thumbnail"], now }),
      {
        ok: false,
        reason: "upload_not_found",
      },
    );
  });

  it("refuses for a deleted upload", () => {
    const deleted = stateAfter(registered(), {
      type: "UploadDeleted",
      payload: { deletedAt: now.toISOString() },
    });

    assert.deepEqual(decideDerivativesProduced(deleted, { derivatives: ["thumbnail"], now }), {
      ok: false,
      reason: "upload_not_found",
    });
  });
});
