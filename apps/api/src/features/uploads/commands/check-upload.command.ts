import type { Command } from "../../../types/command.js";

/**
 * Open an uploaded file and establish what it is.
 *
 * Carries no facts about the file, deliberately. Anything stated here would
 * have to be verified anyway, so the command asks for the file to be examined
 * rather than offering something to believe.
 */
export type CheckUploadCommand = Command<
  "CheckUpload",
  {
    uploadId: string;
  }
>;

/**
 * Build a {@link CheckUploadCommand}.
 *
 * @param uploadId - Which upload to examine.
 * @returns The command.
 */
export function checkUpload(uploadId: string): CheckUploadCommand {
  return { type: "CheckUpload", payload: { uploadId } };
}
