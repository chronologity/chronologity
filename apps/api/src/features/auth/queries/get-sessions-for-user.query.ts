/** List the Sessions an Identity can see and revoke. */
export interface GetSessionsForUserQuery {
  readonly identityId: string;
  /** Marks which entry is the one asking, so a client can say "this device". */
  readonly currentSessionId: string;
}
