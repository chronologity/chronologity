import type { Command } from "../../../types/command.js";

/** Remove an upload and its stored object. */
export type DeleteUploadCommand = Command<
  "DeleteUpload",
  {
    uploadId: string;
    actorUserId: string;
  }
>;

/**
 * Build a {@link DeleteUploadCommand}.
 *
 * @param uploadId - Which upload.
 * @param actorUserId - Who is deleting it. Only its owner may.
 * @returns The command.
 */
export function deleteUpload(uploadId: string, actorUserId: string): DeleteUploadCommand {
  return { type: "DeleteUpload", payload: { uploadId, actorUserId } };
}
