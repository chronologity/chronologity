/** Ask whether a Session may authenticate a request. */
export interface ValidateSessionQuery {
  readonly sessionId: string;
}

export interface ValidatedSession {
  readonly identityId: string;
}
