import type { FastifyBaseLogger, FastifyServerOptions } from "fastify";
import type { AppConfig } from "../config/app-config.js";

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
 *
 * One field list differs from the API's, and it is the one this application
 * adds: a GraphQL request body carries `query` and `variables`, and
 * `feed.md:1244` says not to log GraphQL variables indiscriminately. Variables
 * are where a Moment identifier, a Location, or a person's name arrives, so
 * they are redacted; the operation name and the duration, which are what
 * telemetry actually wants, are not in the body at all.
 *
 * @param config - Supplies the level.
 * @returns Logger options, including the redaction paths. Declaring redaction
 *   here rather than at call sites matters: relying on every future caller to
 *   remember not to log a Moment identifier is not a control.
 */
export function loggerOptions(config: AppConfig): NonNullable<FastifyServerOptions["logger"]> {
  return {
    level: config.logLevel,
    redact: {
      // Each name appears at three depths, and three is a bound rather than a
      // guarantee. Pino's `*` matches exactly one level and it has no recursive
      // wildcard, so a list like this covers the depths it names and no more.
      // The rule that matters remains: log the shape, not the payload.
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
        ...[
          "token",
          "accessToken",
          "refreshToken",
          "secret",
          // A presigned URL is a credential with a hostname in front of it:
          // whoever holds it can read the object until it expires. This service
          // returns media references, so it can be handed one.
          "downloadUrl",
          "signedUrl",
          // The arguments to a GraphQL operation. Whose Timeline, which Moment,
          // which place — the operation name says what was asked, and this says
          // about whom.
          "variables",
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
