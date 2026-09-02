import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { PasswordHashingConfig } from "../../config/auth-config.js";
import {
  hashPassword,
  needsRehash,
  parseHashParameters,
  verifyDummyPassword,
  verifyPassword,
} from "./password.js";

// The schema's floor, so the suite is not dominated by hashing cost. Production
// defaults are higher; the parameters under test are the stored ones either way.
const config: PasswordHashingConfig = { memoryCostKib: 8_192, timeCost: 1, parallelism: 1 };

const password = "a perfectly reasonable passphrase";

describe("hashPassword", () => {
  it("produces an Argon2id hash", async () => {
    // Asserted rather than configured: the package's Algorithm enum cannot be
    // imported under verbatimModuleSyntax, so this is what pins the algorithm.
    const hash = await hashPassword(config, password);

    assert.match(hash, /^\$argon2id\$/);
  });

  it("salts each hash, so the same password hashes differently", async () => {
    const first = await hashPassword(config, password);
    const second = await hashPassword(config, password);

    assert.notEqual(first, second);
  });

  it("embeds the parameters it used", async () => {
    const hash = await hashPassword(config, password);

    assert.deepEqual(parseHashParameters(hash), {
      algorithm: "argon2id",
      memoryCostKib: 8_192,
      timeCost: 1,
      parallelism: 1,
    });
  });
});

describe("verifyPassword", () => {
  it("accepts the right password", async () => {
    const hash = await hashPassword(config, password);

    assert.equal(await verifyPassword(hash, password), true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword(config, password);

    assert.equal(await verifyPassword(hash, "not the password"), false);
    assert.equal(await verifyPassword(hash, ""), false);
    assert.equal(await verifyPassword(hash, `${password} `), false);
  });

  it("returns false rather than throwing on an unreadable hash", async () => {
    // A corrupt row must fail the login, not the request.
    for (const stored of ["", "not-a-hash", "$argon2id$broken", "$2b$10$bcryptish"]) {
      assert.equal(await verifyPassword(stored, password), false);
    }
  });
});

describe("verifyDummyPassword", () => {
  it("always reports failure", async () => {
    assert.equal(await verifyDummyPassword(config, password), false);
    assert.equal(await verifyDummyPassword(config, ""), false);
  });

  it("costs about as much as a real verification", async () => {
    const hash = await hashPassword(config, password);

    const realStart = process.hrtime.bigint();
    await verifyPassword(hash, "wrong password");
    const real = Number(process.hrtime.bigint() - realStart);

    // Warm the cached dummy first: its one-time creation is not the thing an
    // attacker can measure.
    await verifyDummyPassword(config, "warm");

    const dummyStart = process.hrtime.bigint();
    await verifyDummyPassword(config, "wrong password");
    const dummy = Number(process.hrtime.bigint() - dummyStart);

    // Loose bound on purpose: this asserts the dummy path does real work
    // rather than returning immediately, not that timing is identical.
    assert.ok(dummy > real / 4, `dummy ${dummy}ns should be comparable to real ${real}ns`);
  });
});

describe("parseHashParameters", () => {
  it("returns undefined for anything that is not a PHC Argon2 hash", () => {
    for (const stored of ["", "nonsense", "$2b$10$bcryptish", "$argon2id$v=19$"]) {
      assert.equal(parseHashParameters(stored), undefined);
    }
  });
});

describe("needsRehash", () => {
  it("is false when the stored hash matches current cost", async () => {
    const hash = await hashPassword(config, password);

    assert.equal(needsRehash(config, hash), false);
  });

  it("is true when any parameter has been raised since", async () => {
    const hash = await hashPassword(config, password);

    assert.equal(needsRehash({ ...config, memoryCostKib: 19_456 }, hash), true);
    assert.equal(needsRehash({ ...config, timeCost: 3 }, hash), true);
    assert.equal(needsRehash({ ...config, parallelism: 2 }, hash), true);
  });

  it("is false when configured cost has been lowered", async () => {
    // Lowering cost must not downgrade everyone's stored password.
    const hash = await hashPassword({ ...config, memoryCostKib: 19_456 }, password);

    assert.equal(needsRehash(config, hash), false);
  });

  it("is true for a hash from another algorithm or an unreadable one", () => {
    assert.equal(needsRehash(config, "$argon2i$v=19$m=8192,t=1,p=1$c2FsdA$aGFzaA"), true);
    assert.equal(needsRehash(config, "$2b$10$bcryptish"), true);
    assert.equal(needsRehash(config, ""), true);
  });
});
