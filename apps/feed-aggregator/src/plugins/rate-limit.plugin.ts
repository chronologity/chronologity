import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";
import { recordRefusal } from "../observability/metrics.js";

/**
 * How often one reader may ask.
 *
 * **Eligibility bounds what an answer contains; it says nothing about how many
 * answers somebody may collect.** That distinction is the whole reason this
 * exists, and ADR-119 wrote it down while adding the same ceiling to the API's
 * autocomplete: "Autocomplete is an enumeration surface by construction, and a
 * ceiling is the only thing that addresses that." A Timeline is the same shape.
 * Every refusal this service makes is correct and none of them is free, so a
 * reader walking identifiers is asking the system to do unbounded work to tell
 * them nothing — `feed.md:1352` calls it high-cardinality jump probing.
 *
 * **Keyed on the reader, falling back to the connection.** Every read here needs
 * an account (ADR-139), so the account is the unit that means something: keying
 * on address alone would give a household, an office or a school one budget
 * between them, and give somebody with a new address a fresh one whenever they
 * liked. The address is what remains for a request that has not authenticated,
 * which is a request about to be refused anyway.
 *
 * **Uniform, and that is a product constraint rather than a simplification.**
 * `feed.md:1342`: "Rate limiting must not be implemented as a hidden ranking
 * mechanism." A limiter that gave some readers more room than others would be
 * deciding whose history loads, which is the thing this whole service is built
 * not to do.
 *
 * In-process, so each replica counts separately. ADR-042 permits that and
 * requires a measurement before Redis; one instance makes it exact and several
 * make it generous, which is the right direction to be wrong in.
 */

/** What a deployment may set. Injected so a suite can raise or lower it. */
export interface RateLimits {
  /** How many requests one reader may make per window. */
  readonly perWindow: number;
  /** How long the window is, in minutes. */
  readonly windowMinutes: number;
}

/**
 * The ceiling a deployment gets if it sets none.
 *
 * Three hundred a minute, matching `apps/api`'s. Five a second is far above what
 * scrolling a Timeline produces — a page arrives, somebody reads it — and far
 * below what walking identifiers produces. It is deliberately not derived from a
 * latency measurement: this bounds how often somebody may ask, which is a
 * question about people rather than about how fast the answer comes back.
 */
export const defaultRateLimits: RateLimits = { perWindow: 300, windowMinutes: 1 };

/**
 * Refuse a reader who is asking too often.
 *
 * Registered inside the GraphQL scope and after authentication, so the Viewer
 * exists to key on. That ordering costs one Session lookup for a request about
 * to be refused, which is the price of keying on the reader rather than the
 * address — and the layer that should be turning away floods before they reach a
 * process at all is the edge (`scalability.md:841`), not this.
 *
 * @param app - The scope to register on.
 * @param limits - The ceiling.
 * @returns Nothing.
 */
export const rateLimitPlugin = fp(async (app, limits: RateLimits) => {
  await app.register(rateLimit, {
    max: limits.perWindow,
    timeWindow: `${limits.windowMinutes} minute`,
    // **`preHandler`, not the default `onRequest`, and this is the whole
    // configuration.** Authentication resolves the Viewer in `preHandler`, so a
    // limiter running at `onRequest` runs before there is a Viewer to key on —
    // and silently keys every request by address instead. Nothing about that
    // fails: it limits, it returns 429, and it shares one budget between
    // everybody behind a router. The suite catches it by asking whether a
    // second reader over the same connection is refused.
    hook: "preHandler",
    // The account, or the connection when there is not one.
    //
    // Two ways to have no account, and both fall back: an anonymous Viewer,
    // which is a real state rather than an absent one, and somebody signed in
    // who has not finished creating an account — `userId` is optional for
    // exactly that reason. Neither can be read history, so both are keyed by
    // address along with everybody else who cannot.
    keyGenerator: (request) => {
      const viewer = request.viewer;
      const account = viewer?.kind === "authenticated" ? viewer.userId : undefined;

      return account ?? request.ip;
    },
    // What remains is withheld for the reason `apps/api` withholds it: a
    // countdown tells somebody exactly how hard they may push. `retry-after`
    // stays, because a client that backs off correctly needs it.
    addHeadersOnExceeding: { "x-ratelimit-remaining": false },
    addHeaders: { "x-ratelimit-remaining": false, "retry-after": true },
    onExceeding: () => {
      recordRefusal("rate");
    },
  });
});
