import type { ErrorCode, ErrorResponse } from "@chronologity/contracts";

/**
 * An error the API returned in its stable envelope.
 *
 * Its own module rather than living beside the client, because the retry policy
 * needs to recognise one and the client needs to throw one — and a client that
 * imported the policy while the policy imported the client would be a cycle
 * spelled across two files.
 */
export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly code: ErrorCode;
  readonly status: number;
  readonly traceId: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * Build an error from the API's stable envelope.
   *
   * @param status - The HTTP status returned.
   * @param response - The envelope body.
   */
  constructor(status: number, response: ErrorResponse) {
    super(response.message);
    this.status = status;
    this.code = response.code;
    this.traceId = response.traceId;
    this.details = response.details;
  }
}
