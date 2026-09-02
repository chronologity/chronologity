#!/usr/bin/env node
//
// Build the breached-password index committed at apps/api/data/.
//
// Usage:
//   node scripts/build-breached-password-index.mjs [path-to-wordlist.txt]
//
// With no argument it downloads the source list. The output is committed, so
// this script exists to make that artifact reproducible and its provenance
// checkable rather than to run during a build — nothing at build or deploy
// time should depend on reaching the network.
//
// Source: the UK National Cyber Security Centre's 100,000 most-used passwords,
// derived from the Have I Been Pwned corpus and published by NCSC specifically
// so that services can refuse them. Vendored via SecLists.
//
// The index stores the first 8 bytes of each password's SHA-1, sorted. SHA-1
// because that is how the corpus is distributed and compared; truncated
// because 64 bits over 100,000 entries makes an accidental collision
// vanishingly unlikely, and unlike a Bloom filter it produces no false
// positives — nobody is told their password is breached when it is not.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt";

/** Checksum of the source list this index was last built from. */
const SOURCE_SHA256 = "c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0";

const PREFIX_BYTES = 8;
const OUTPUT = new URL("../data/breached-passwords.bin", import.meta.url);

/**
 * Read the wordlist, from disk or from the source URL.
 *
 * @param argument - A local path, or undefined to download.
 * @returns The list as text.
 * @throws {Error} If the download fails.
 */
async function readSource(argument) {
  if (argument !== undefined) {
    return readFile(argument, "utf8");
  }

  const response = await fetch(SOURCE_URL);

  if (!response.ok) {
    throw new Error(`Could not fetch the source list: ${response.status}`);
  }

  return response.text();
}

const source = await readSource(process.argv[2]);
const checksum = createHash("sha256").update(source).digest("hex");

if (checksum !== SOURCE_SHA256) {
  // Not fatal: the upstream list is occasionally updated. It should be a
  // deliberate act, though, with the constant above updated to match.
  process.stderr.write(
    `Warning: source checksum ${checksum} does not match the recorded ${SOURCE_SHA256}\n`,
  );
}

const passwords = source
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

const prefixes = passwords.map((password) =>
  createHash("sha1").update(password, "utf8").digest().subarray(0, PREFIX_BYTES),
);

// Sorted so the runtime can binary search rather than hold a hash set.
prefixes.sort(Buffer.compare);

const deduplicated = prefixes.filter(
  (prefix, index) => index === 0 || Buffer.compare(prefix, prefixes[index - 1]) !== 0,
);

await writeFile(fileURLToPath(OUTPUT), Buffer.concat(deduplicated));

process.stdout.write(
  `Wrote ${deduplicated.length} entries (${passwords.length} passwords, ` +
    `${passwords.length - deduplicated.length} duplicate prefixes) ` +
    `to ${fileURLToPath(OUTPUT)}\n`,
);
