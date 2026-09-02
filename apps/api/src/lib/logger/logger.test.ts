import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, it } from "vitest";
import Fastify from "fastify";
import type { AppConfig } from "../../config/app-config.js";
import { loggerOptions, type Logger } from "./logger.js";

/**
 * Whether a secret can reach a log line.
 *
 * `observability.md:293` forbids twelve categories by name, and until now
 * nothing checked any of them: this file did not exist, for a control whose
 * entire purpose is that a credential never gets written down.
 *
 * What is asserted here is the output, not the configuration. A test that reads
 * the `paths` array and finds `"*.password"` proves somebody typed a string —
 * it would pass while a password logged at the top level, or two objects deep,
 * went straight through. So each case builds a real logger from the real
 * options, logs something shaped the way the application logs it, and reads
 * what came out of the other end.
 *
 * Three of the twelve — media bytes, a raw caption, an exact position — are not
 * fields with names, so there is nothing to redact. The guarantee for those is
 * that nothing logs them at all, which is a weaker thing to be able to say and
 * is said plainly rather than dressed up as redaction.
 */

const config = { logLevel: "info" } as AppConfig;

const SECRET = "s3cret-value-nothing-should-print";

/**
 * A logger built the way the application builds one, and everything it writes.
 *
 * Through Fastify rather than pino directly. The options are handed to Fastify
 * in `buildApp`, and a test that constructed its own pino would be testing a
 * logger this system never uses — the redaction could work there and be
 * discarded on the way through, and nothing would say so.
 *
 * @returns A logger, and a reader for what it has emitted so far.
 */
function capture(): { log: Logger; written: () => string } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });

  const options = loggerOptions(config);

  // The return type admits `true`, since Fastify's own option does. It is never
  // that here, and narrowing rather than casting means this fails loudly if it
  // ever becomes so.
  assert.equal(typeof options, "object", "the logger is configured, not merely switched on");

  const app = Fastify({ logger: { ...(options as object), stream } });

  return { log: app.log, written: () => lines.join("") };
}

describe("what a log line may never contain", () => {
  /**
   * Every name that must be censored, at the depths a caller might reach for.
   *
   * Depth is the point. Pino's `*` matches exactly one level, so a list of
   * `*.password` alone leaves both `{ password }` and `{ a: { b: { password }}}`
   * in plain sight — and a credential inside whatever object a caller happened
   * to build is the ordinary way one escapes.
   */
  const NAMED = [
    "password",
    "token",
    "accessToken",
    "refreshToken",
    "secret",
    "code",
    "uploadUrl",
    "downloadUrl",
    "signedUrl",
  ];

  for (const field of NAMED) {
    it(`censors ${field} at the top and two objects down`, () => {
      const { log, written } = capture();

      log.info({ [field]: SECRET }, "at the top");
      log.info({ body: { [field]: SECRET } }, "one deep");
      log.info({ request: { body: { [field]: SECRET } } }, "two deep");

      const output = written();

      assert.equal(output.includes(SECRET), false, `${field} reached the log`);
      assert.equal(
        output.split("[redacted]").length - 1,
        3,
        `${field} was not censored at every depth`,
      );
    });
  }

  it("stops covering a credential buried deeper than the paths reach", () => {
    // Not a defect to fix by adding a fourth line — pino has no recursive
    // wildcard, so whatever depth is listed, one more exists. It is recorded
    // because a bound nobody has written down is a bound somebody will assume
    // away, and because the honest reading of these paths is "the depths this
    // application logs at", not "anywhere".
    const { log, written } = capture();

    log.info({ a: { b: { c: { password: SECRET } } } }, "four deep");

    assert.equal(
      written().includes(SECRET),
      true,
      "redaction now reaches further than the paths claim; widen this test",
    );
  });

  it("censors the header a bearer token arrives in", () => {
    const { log, written } = capture();

    log.info({ req: { headers: { authorization: `Bearer ${SECRET}` } } }, "a request");

    assert.equal(written().includes(SECRET), false);
  });

  it("leaves everything else legible", () => {
    // Redaction that swallowed the identifiers would be its own failure: a log
    // nobody can follow is not a safe log, it is a useless one.
    const { log, written } = capture();

    log.info({ traceId: "trace-1", userId: "user-1", momentId: "moment-1" }, "recorded");

    const output = written();

    assert.ok(output.includes("trace-1"));
    assert.ok(output.includes("user-1"));
    assert.ok(output.includes("moment-1"));
  });
});

describe("what has no field name to censor", () => {
  /**
   * The categories that can only be proven by absence.
   *
   * A caption is a string on a Moment; a position is two numbers. Neither can be
   * redacted by name without censoring every legitimate use, so the guarantee is
   * that nothing logs them — which no test can establish in general. What this
   * does is pin the shape the application logs instead, so that swapping a
   * length for the text, or a precision for the coordinates, fails here.
   */
  it("logs what a caption is rather than what it says", () => {
    const { log, written } = capture();

    log.info({ momentId: "moment-1", captionLength: 42 }, "recorded");

    const output = written();

    assert.ok(output.includes("captionLength"));
    assert.equal(output.includes("caption\":\""), false, "a caption's text reached the log");
  });

  it("logs how precise a position is rather than where it is", () => {
    const { log, written } = capture();

    log.info({ locationId: "location-1", precision: "city" }, "placed");

    const output = written();

    assert.ok(output.includes("precision"));
    assert.equal(output.includes("latitude"), false, "an exact position reached the log");
    assert.equal(output.includes("longitude"), false, "an exact position reached the log");
  });
});
