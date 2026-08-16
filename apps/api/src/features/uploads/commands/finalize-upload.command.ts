import type { Command } from "../../../types/command.js";

/**
 * Tell the server the bytes have been uploaded.
 *
 * Carries no facts about the object on purpose. Anything the client said here
 * would have to be verified anyway, so the command asks the server to look
 * rather than offering it something to believe.
 */
export type FinalizeUploadCommand = Command<
  "FinalizeUpload",
  {
    uploadId: string;
    actorUserId: string;
  }
>;

/**
 * Build a {@link FinalizeUploadCommand}.
 *
 * @param uploadId - Which upload.
 * @param actorUserId - Who is finalizing it. Only its owner may.
 * @returns The command.
 */
export function finalizeUpload(uploadId: string, actorUserId: string): FinalizeUploadCommand {
  return { type: "FinalizeUpload", payload: { uploadId, actorUserId } };
}
