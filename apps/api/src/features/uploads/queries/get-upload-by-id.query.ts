/** Read one upload. */
export interface GetUploadByIdQuery {
  readonly uploadId: string;
  /** Whose request this is. Only an upload's owner may read it. */
  readonly actorUserId: string;
}
