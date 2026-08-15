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

  return {
    status: 500,
    body: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      traceId,
    },
  };
}
