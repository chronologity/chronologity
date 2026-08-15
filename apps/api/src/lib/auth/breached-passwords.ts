import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Passwords known to have appeared in breaches.
 *
 * Attackers do not guess randomly; they replay passwords that have already
 * leaked elsewhere. A password can be long, unusual, and free of obvious
 * patterns while still being the first thing tried, because someone used it on
 * a site that was breached. NIST 800-63B recommends refusing these, and
 * `security.md:345` leaves the mechanism open.
 *
 * The corpus is vendored rather than queried. The usual approach calls Have I
 * Been Pwned's range API during registration, which puts a third party in the
 * sign-in path and forces an unpleasant choice when it is unreachable: fail
 * open and the control silently stops working, or fail closed and someone
 * else's outage becomes ours. A local index has neither failure mode, costs
 * microseconds, and tells nobody who is signing up.
 *
 * The index holds the first 8 bytes of each password's SHA-1, sorted. It is
 * built by `scripts/build-breached-password-index.mjs`, which records where
 * the list came from.
 */

const INDEX_PATH = new URL("../../../data/breached-passwords.bin", import.meta.url);

const PREFIX_BYTES = 8;

let index: Buffer | undefined;

/**
 * Load the index into memory.
 *
 * Throws if it is missing or malformed. A deployment without it is a broken
 * build, and quietly treating every password as clean would disable the check
 * exactly where nobody would notice — the failure mode this design exists to
 * avoid.
 *
 * Called at startup so that failure surfaces at boot rather than on someone's
 * first registration.
 */
export function loadBreachedPasswordIndex(): void {
  if (index !== undefined) {
    return;
  }

  const contents = readFileSync(fileURLToPath(INDEX_PATH));

  if (contents.length === 0 || contents.length % PREFIX_BYTES !== 0) {
    throw new Error(
      `Breached-password index is malformed: ${contents.length} bytes is not a multiple of ${PREFIX_BYTES}`,
    );
  }

  index = contents;
}

/** How many passwords the index covers. Used by tests and diagnostics. */
export function breachedPasswordCount(): number {
  loadBreachedPasswordIndex();

  return (index?.length ?? 0) / PREFIX_BYTES;
}

/**
 * Whether a password appears in the breach corpus.
 *
 * Binary search over the sorted index. Synchronous and in memory: this runs on
 * registration, reset, and change, and none of those should wait on anything.
 */
export function isBreachedPassword(password: string): boolean {
  loadBreachedPasswordIndex();

  if (index === undefined) {
    return false;
  }

  const target = createHash("sha1").update(password, "utf8").digest().subarray(0, PREFIX_BYTES);

  let low = 0;
  let high = index.length / PREFIX_BYTES - 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    const offset = middle * PREFIX_BYTES;

    // The static form, deliberately: `buffer.compare(target)` reports the
    // ordering from the buffer's point of view, which reads as the opposite of
    // what a binary search wants and silently sends the search the wrong way.
    const comparison = Buffer.compare(target, index.subarray(offset, offset + PREFIX_BYTES));

    if (comparison === 0) {
      return true;
    }

    if (comparison < 0) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  return false;
}
