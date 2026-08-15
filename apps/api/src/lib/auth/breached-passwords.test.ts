import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  breachedPasswordCount,
  isBreachedPassword,
  loadBreachedPasswordIndex,
} from "./breached-passwords.js";

/**
 * Entries known to be in the vendored NCSC corpus.
 *
 * Chosen from across the sorted index rather than the first few, because a
 * binary search that walks the wrong direction still finds whatever happens to
 * sit at the midpoint. That is precisely the bug these tests exist to catch:
 * a lookup that silently answers "not breached" for everything disables the
 * control without failing anything.
 */
const KNOWN_BREACHED = [
  "123456",
  "password",
  "qwerty",
  "iloveyou",
  "q1w2e3r4t5y6",
  "PE#5GZ29PTZMSE",
  "Sojdlg123aljg",
  "1qaz2wsx3edc",
  "zaq1zaq1",
  "trustno1",
];

/** Passphrases that must not be refused. */
const NOT_BREACHED = [
  "a perfectly reasonable passphrase",
  "sailing to byzantium 1928",
  "monkeys are wonderful animals",
  "the seventeenth of never",
  "gg7XrLmQ2vTnBw9sKpEh",
];

describe("breached password index", () => {
  it("loads", () => {
    loadBreachedPasswordIndex();

    assert.ok(breachedPasswordCount() > 90_000, "corpus looks too small to be the real one");
  });

  it("is idempotent to load", () => {
    loadBreachedPasswordIndex();
    const first = breachedPasswordCount();
    loadBreachedPasswordIndex();

    assert.equal(breachedPasswordCount(), first);
  });
});

describe("isBreachedPassword", () => {
  it("finds passwords that are in the corpus", () => {
    for (const password of KNOWN_BREACHED) {
      assert.equal(isBreachedPassword(password), true, password);
    }
  });

  it("does not refuse passphrases that are not", () => {
    for (const password of NOT_BREACHED) {
      assert.equal(isBreachedPassword(password), false, password);
    }
  });

  it("is case and whitespace sensitive, since the corpus is", () => {
    // "Password" is a different string from "password" and leaked separately
    // if at all. Normalising here would answer a question nobody asked.
    assert.equal(isBreachedPassword("password"), true);
    assert.equal(isBreachedPassword(" password "), false);
  });

  it("handles inputs that could break a naive lookup", () => {
    for (const password of ["", "\0", "🔥".repeat(50), "a".repeat(10_000)]) {
      assert.equal(typeof isBreachedPassword(password), "boolean");
    }
  });
});
