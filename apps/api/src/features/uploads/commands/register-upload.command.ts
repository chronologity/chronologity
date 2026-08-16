import type { Command } from "../../../types/command.js";

/** Ask for permission to upload one object. */
export type RegisterUploadCommand = Command<
  "RegisterUpload",
  {
    ownerUserId: string;
    /** What the client says it will send. Verified at finalization. */
    declaredContentType: string;
    declaredByteSize: number;
  }
>;

/**
 * Build a {@link RegisterUploadCommand}.
 *
 * @param ownerUserId - Who is uploading.
 * @param input - The declared content type and size.
 * @returns The command.
 */
export function registerUpload(
  ownerUserId: string,
  input: { contentType: string; declaredByteSize: number },
): RegisterUploadCommand {
  return {
    type: "RegisterUpload",
    payload: {
      ownerUserId,
      declaredContentType: input.contentType,
      declaredByteSize: input.declaredByteSize,
    },
  };
}
