import type { ErrorResponse } from "@chronologity/contracts";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { DomainError } from "./domain-error.js";

export interface MappedError {
  readonly status: number;
  readonly body: ErrorResponse;
}

/**
 * Map any thrown value onto the stable error envelope.
 *
 * The default is deliberately uninformative. Stack traces, SQL errors,
 * event-store errors, secrets, and raw provider failures must never reach a
 * client, so only errors that deliberately describe themselves — `DomainError`
 * and schema validation failures — contribute a message. Everything else
 * becomes an internal error whose detail exists solely in the logs, findable
 * by trace identifier.
 *
 * @param error - Anything thrown, including values that are not errors.
 * @param traceId - Ties the sanitized response to the full detail in the logs.
 * @returns The status and the envelope to send. Only errors that deliberately
 *   describe themselves contribute a message; everything else becomes an
 *   internal error, so a stack trace, SQL error, or provider failure cannot
 *   reach a client.
 */
export function toErrorResponse(error: unknown, traceId: string): MappedError {
  if (error instanceof DomainError) {
    return {
      status: error.status,
      body: {
        code: error.code,
        message: error.message,
        traceId,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }

  if (hasZodFastifySchemaValidationErrors(error)) {
    return {
      status: 400,
      body: {
        code: "VALIDATION_FAILED",
        message: "Request failed validation",
        traceId,
        details: {
          issues: error.validation.map((issue) => ({
            path: issue.instancePath,
            message: issue.message,
          })),
        },
      },
    };
  }

  // Fastify and its plugins reject some requests before a handler ever runs:
  // rate limits, oversized bodies, unsupported media types. Those carry a
  // deliberate 4xx status, and treating them as unexpected would report a
  // refusal the system meant as a server failure it did not have.
  const framework = frameworkStatus(error);

  if (framework !== undefined) {
    return {
      status: framework,
      body: {
        code: CODE_FOR_STATUS[framework] ?? "VALIDATION_FAILED",
        // Our wording, not the framework's: its messages are written for
        // developers and occasionally name internals.
        message: MESSAGE_FOR_STATUS[framework] ?? "Request rejected",
        traceId,
      },
    };
  }

  return {
    status: 500,
    body: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      traceId,
    },
  };
}

const CODE_FOR_STATUS: Readonly<Record<number, ErrorResponse["code"]>> = {
  400: "VALIDATION_FAILED",
  401: "AUTHENTICATION_FAILED",
  403: "AUTHORIZATION_DENIED",
  404: "NOT_FOUND",
  413: "VALIDATION_FAILED",
  415: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
};

const MESSAGE_FOR_STATUS: Readonly<Record<number, string>> = {
  400: "Request failed validation",
  401: "Authentication required",
  403: "Not permitted",
  404: "Not found",
  413: "Request payload is too large",
  415: "Unsupported content type",
  429: "Too many requests",
};

/**
 * The status a framework-level rejection asked for, if any.
 *
 * Only 4xx is honoured. A plugin reporting 5xx is reporting a failure, and
 * failures go through the unexpected-error path where their detail stays in
 * the logs.
 *
 * @param error - The thrown value.
 * @returns The status a framework-level rejection asked for, or undefined. Only
 *   4xx is honoured: a plugin reporting 5xx is reporting a failure, and failures
 *   go through the unexpected-error path where their detail stays in the logs.
 */
function frameworkStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return undefined;
  }

  const status = (error as { statusCode: unknown }).statusCode;

  if (typeof status !== "number" || !Number.isInteger(status) || status < 400 || status > 499) {
    return undefined;
  }

  return status;
}
