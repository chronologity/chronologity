import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { PasswordPolicyConfig } from "../../config/auth-config.js";
import { checkPassword, describeRejection } from "./password-policy.js";

const config: PasswordPolicyConfig = { minimumLength: 12, maximumLength: 256 };

describe("checkPassword", () => {
  it("accepts a long passphrase", () => {
    assert.deepEqual(checkPassword(config, "a perfectly reasonable passphrase"), { ok: true });
  });

  it("rejects anything shorter than the minimum", () => {
    assert.deepEqual(checkPassword(config, "short"), { ok: false, reason: "too_short" });
    assert.deepEqual(checkPassword(config, "elevenchars"), { ok: false, reason: "too_short" });
    assert.deepEqual(checkPassword(config, "twelvechars!"), { ok: true });
  });

  it("rejects anything past the maximum", () => {
    // The bound exists to cap work on an unauthenticated endpoint, not because
    // long passwords are weak. Varied text, since a single repeated character
    // is refused on its own merits however long it is.
    const varied = "correct battery staple ".repeat(12);

    assert.deepEqual(checkPassword(config, varied.slice(0, 257)), {
      ok: false,
      reason: "too_long",
    });
    assert.deepEqual(checkPassword(config, varied.slice(0, 256)), { ok: true });
  });

  it("rejects passwords an attacker guesses first", () => {
    for (const common of ["password1234", "123456789012", "correcthorsebatterystaple"]) {
      assert.equal(checkPassword(config, common).ok, false, common);
    }
  });

  it("sees through character substitution", () => {
    // Every cracking wordlist applies these mappings, so the check has to as
    // well. Deleting the symbols instead would turn "P@ssw0rd" into "pssw0rd"
    // and miss the match entirely.
    // Each is one weak word wearing decoration, which is the case this
    // catches. It deliberately does not match a common word merely appearing
    // inside a longer password: that would reject "monkeys are wonderful".
    for (const decorated of ["P@ssw0rd-123!", "L3tm31n!!!!!!", "@dm1n1str@t0r", "W3lc0me!!!!!!"]) {
      assert.equal(checkPassword(config, decorated).ok, false, decorated);
    }
  });

  it("rejects trivial patterns regardless of length", () => {
    // Length alone is not entropy: these fall quickly however long they are,
    // and no wordlist needs to contain them.
    assert.deepEqual(checkPassword(config, "123456789012"), { ok: false, reason: "too_common" });
    assert.deepEqual(checkPassword(config, "0".repeat(40)), { ok: false, reason: "too_common" });
    assert.deepEqual(checkPassword(config, "a".repeat(30)), { ok: false, reason: "too_common" });
  });

  it("refuses a password that has appeared in a breach", () => {
    // Long, unpatterned, and not in the small embedded list — but already in
    // every credential-stuffing list, which is what actually matters.
    assert.deepEqual(checkPassword(config, "PE#5GZ29PTZMSE"), { ok: false, reason: "breached" });
    assert.deepEqual(checkPassword(config, "Sojdlg123aljg"), { ok: false, reason: "breached" });
  });

  it("leaves genuine passphrases alone", () => {
    // The substitution check must not become a source of false rejections.
    for (const good of [
      "banana pancakes forever",
      "a perfectly reasonable passphrase",
      "twelvechars!",
      "sailing to byzantium 1928",
      "monkeys are wonderful animals",
    ]) {
      assert.deepEqual(checkPassword(config, good), { ok: true }, good);
    }
  });

  it("rejects a password containing the address it protects", () => {
    assert.deepEqual(checkPassword(config, "richardbumbury-2026", "richardbumbury@example.com"), {
      ok: false,
      reason: "contains_email",
    });
  });

  it("ignores a very short local part when checking for the address", () => {
    // "ana@example.com" would otherwise reject any password containing "ana".
    assert.deepEqual(checkPassword(config, "banana pancakes forever", "ana@example.com"), {
      ok: true,
    });
  });

  it("imposes no composition rules", () => {
    // Requiring symbols and digits pushes people toward predictable patterns.
    assert.deepEqual(checkPassword(config, "all lowercase words here"), { ok: true });
  });
});

describe("describeRejection", () => {
  it("explains each rejection in terms someone can act on", () => {
    assert.match(describeRejection("too_short", config), /at least 12/);
    assert.match(describeRejection("too_long", config), /at most 256/);
    assert.match(describeRejection("too_common", config), /guessed/);
    assert.match(describeRejection("contains_email", config), /email/);
    // Said plainly: someone whose password has leaked has almost certainly
    // used it somewhere else too.
    assert.match(describeRejection("breached", config), /data breach/);
  });
});
