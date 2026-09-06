import { ConfigurationError, parseEnv } from "@chronologity/config";
import { z } from "zod";

/**
 * What this application must be told, and what happens when it is not.
 *
 * **Two addresses, because there are two backends.** Chronologity's client
 * deliberately speaks REST to the authoritative API and GraphQL to the
 * read-only Timeline aggregator (`monorepo.md:1465`), and in development those
 * are two ports on one machine.
 *
 * **Neither has a default, and that is the point.** `packages/config` puts it
 * plainly: a default exists only for a value that is safe to guess. An address
 * is never safe to guess — a wrong one does not fail, it succeeds against
 * something else. What a missing address should do is stop the application at
 * launch, where the message says which variable, rather than surface later as a
 * request that will not connect.
 *
 * **Each variable is named outright rather than read off `process.env`.** Expo
 * substitutes `EXPO_PUBLIC_*` into the bundle at build time by finding the
 * literal text, so a dynamic lookup finds nothing and a spread finds an empty
 * object. This reads like repetition and is not optional.
 *
 * **`EXPO_PUBLIC_` means public.** Anything under that prefix is compiled into
 * the binary, and `security.md:1655` is explicit that a value shipped in the
 * binary is discoverable. Addresses qualify. A credential never would.
 *
 * **The scheme is required rather than assumed.** `packages/config`'s
 * `urlSchema` is `z.url()`, which accepts `localhost:3000` — parsed as a URL
 * whose protocol is `localhost:` — and accepts `ftp://` too. Neither is
 * something `fetch` can use, and the first is exactly the typo somebody makes
 * writing this variable by hand. The shared schema stays as it is; this is the
 * narrower thing an address for `fetch` has to be.
 */
const addressSchema = z.url({ protocol: /^https?$/ });

export const envSchema = z.object({
  EXPO_PUBLIC_API_URL: addressSchema,
  EXPO_PUBLIC_FEED_URL: addressSchema,
});

export type Env = z.infer<typeof envSchema>;

/**
 * Read the environment this build was compiled with.
 *
 * @param source - Where to read from. Defaults to the values Expo inlined, and
 *   is injectable so a test can supply its own without touching the process.
 * @returns The validated environment.
 * @throws {ConfigurationError} If anything required is missing or malformed,
 *   naming every problem rather than only the first.
 */
export function readEnv(source: Record<string, string | undefined> = inlined()): Env {
  return parseEnv(envSchema, source);
}

/**
 * The values Expo substituted at build time.
 *
 * @returns Them, as an ordinary object.
 */
function inlined(): Record<string, string | undefined> {
  return {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_FEED_URL: process.env.EXPO_PUBLIC_FEED_URL,
  };
}

export { ConfigurationError };
