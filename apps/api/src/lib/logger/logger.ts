import type { FastifyBaseLogger, FastifyServerOptions } from "fastify";
import type { AppConfig } from "../../config/app-config.js";

export type Logger = FastifyBaseLogger;

/**
 * Structured logging configuration (ADR-044).
 *
 * Logs are JSON in every environment, including development: a log format that
 * differs between environments is a log format that has never been tested where
 * it matters.
 *
 * Redaction is declared here rather than at call sites. Relying on every future
 * caller to remember not to log a token is not a control.
 */
// NonNullable: the repository compiles with exactOptionalPropertyTypes, so a
// return type that includes undefined cannot be assigned to an optional field.
/**
 * Structured logging configuration.
 *
 * @param config - Supplies the level.
 * @returns Logger options, including the redaction paths. Declaring redaction
 *   here rather than at call sites matters: relying on every future caller to
 *   remember not to log a token is not a control.
 */
export function loggerOptions(config: AppConfig): NonNullable<FastifyServerOptions["logger"]> {
  return {
    level: config.logLevel,
    redact: {
      // `observability.md:293` names twelve categories that must never appear.
      // Several are not fields with names — media bytes, a raw caption, an
      // exact position — and for those the guarantee is that nothing logs them
      // at all, which `logger.test.ts` asserts by absence rather than by
      // redaction. What is listed here is everything that does have a name.
      //
      // Each name appears at three depths, and three is a bound rather than a
      // guarantee. Pino's `*` matches exactly one level and it has no recursive
      // wildcard, so a list like this covers the depths it names and no more:
      // the previous list of `*.password` alone left both a top-level
      // `password` and anything two deep in plain sight, which is measured in
      // `logger.test.ts`.
      //
      // Nought to two covers how this application logs — a value, an object a
      // caller built, or a request body inside one. A credential four levels
      // down would still print, so the rule that matters remains: log the
      // shape, not the payload. `logger.test.ts` pins the limit rather than
      // leaving somebody to discover it.
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
        ...[
          "password",
          // Covers a device's push token, which is a credential for reaching
          // somebody's lock screen rather than an identifier for it.
          "token",
          "accessToken",
          "refreshToken",
          "secret",
          // A sign-in code, a phone code, a recovery code. Short-lived and
          // sufficient on their own, which is what makes them credentials.
          "code",
          // A presigned URL is a credential with a hostname in front of it:
          // whoever holds it can read or write the object until it expires.
          "uploadUrl",
          "downloadUrl",
          "signedUrl",
        ].flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
      ],
      censor: "[redacted]",
    },
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          traceId: request.headers["x-trace-id"],
        };
      },
    },
  };
}
