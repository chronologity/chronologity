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
export function loggerOptions(config: AppConfig): NonNullable<FastifyServerOptions["logger"]> {
  return {
    level: config.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
        "*.password",
        "*.token",
        "*.accessToken",
        "*.refreshToken",
        "*.secret",
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
