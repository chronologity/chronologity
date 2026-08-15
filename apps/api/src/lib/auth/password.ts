import { hash, verify } from "@node-rs/argon2";
import type { PasswordHashingConfig } from "../../config/auth-config.js";

/**
 * Password hashing.
 *
 * Argon2id, as `docs/architecture/security.md:329` requires. Passwords are
 * chosen by people, so they are guessable in a way random tokens are not, and
 * the whole point of a purpose-built password hash is to make each guess
 * expensive. Ordinary fast hashes are explicitly forbidden (`security.md:1204`).
 *
 * Cost parameters are configuration rather than constants: hardware improves,
 * and raising them must not require a code change. Stored hashes carry the
 * parameters they were made with, so raising the cost does not invalidate
 * anyone — {@link needsRehash} migrates each password on its next successful
 * use.
 */

/**
 * Argon2id is this package's default and is asserted by a test, rather than
 * named here: its `Algorithm` enum is an ambient const enum, which cannot be
 * imported as a value while `verbatimModuleSyntax` is on.
 */
function toOptions(config: PasswordHashingConfig) {
  return {
    memoryCost: config.memoryCostKib,
    timeCost: config.timeCost,
    parallelism: config.parallelism,
  };
}

/** Hash a password for storage. The salt is generated per call by Argon2. */
export async function hashPassword(
  config: PasswordHashingConfig,
  password: string,
): Promise<string> {
  return hash(password, toOptions(config));
}

/**
 * Check a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed or unreadable hash: a
 * corrupt row must fail the login, not the request, and certainly must not
 * surface a parser error to a caller probing with nonsense.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/**
 * A hash used only to spend the same time as a real verification.
 *
 * Skipping the hash when an address is unknown returns measurably sooner and
 * turns login into an account-existence oracle. Callers verify against this
 * instead, so both paths cost the same.
 *
 * Cached per parameter set, because computing it costs exactly as much as the
 * hashing it is imitating and doing that on every unknown-address attempt
 * would hand out a denial-of-service lever.
 */
const dummyHashes = new Map<string, Promise<string>>();

export async function verifyDummyPassword(
  config: PasswordHashingConfig,
  password: string,
): Promise<false> {
  const key = `${config.memoryCostKib}:${config.timeCost}:${config.parallelism}`;

  let dummy = dummyHashes.get(key);

  if (dummy === undefined) {
    dummy = hashPassword(config, "a password no account has, used only for timing");
    dummyHashes.set(key, dummy);
  }

  await verifyPassword(await dummy, password);

  // Always false. The result is discarded; only the elapsed time matters.
  return false;
}

/** The parameters a stored hash was produced with. */
export interface StoredHashParameters {
  readonly algorithm: string;
  readonly memoryCostKib: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

/**
 * Read the parameters out of a PHC-format hash.
 *
 * Argon2 encodes them in the hash itself — `$argon2id$v=19$m=19456,t=2,p=1$…` —
 * which is what allows cost to be raised without a migration.
 */
export function parseHashParameters(storedHash: string): StoredHashParameters | undefined {
  const match = /^\$(argon2(?:id|i|d))\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);

  if (match === null) {
    return undefined;
  }

  return {
    algorithm: match[1] ?? "",
    memoryCostKib: Number(match[2]),
    timeCost: Number(match[3]),
    parallelism: Number(match[4]),
  };
}

/**
 * Whether a stored hash should be replaced on next successful login.
 *
 * True when the hash is weaker than current configuration, or was made by a
 * different algorithm. Deliberately not true when it is *stronger*: lowering
 * configured cost should not trigger a fleet-wide downgrade of everyone's
 * stored password.
 */
export function needsRehash(config: PasswordHashingConfig, storedHash: string): boolean {
  const stored = parseHashParameters(storedHash);

  if (stored === undefined) {
    // Unreadable, so it cannot be assessed. Replacing it is the safe answer.
    return true;
  }

  return (
    stored.algorithm !== "argon2id" ||
    stored.memoryCostKib < config.memoryCostKib ||
    stored.timeCost < config.timeCost ||
    stored.parallelism < config.parallelism
  );
}
