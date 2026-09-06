import { ApiError } from "@chronologity/api-client";
import { StyleSheet, Text, View } from "react-native";

/**
 * Telling somebody why they are not looking at what they asked for.
 *
 * **The distinction this exists to preserve.** ADR-151 was written because a
 * Timeline whose read failed mid-composition is, to a client, indistinguishable
 * from a Timeline with nothing in it — and those two things mean opposite
 * situations to a person. One says the service is unwell and to try again; the
 * other says this part of their history is genuinely empty. Rendering an outage
 * as emptiness would tell somebody their history had disappeared.
 *
 * So the code decides the words, and the codes are the ones
 * `packages/contracts` already publishes. Nothing here parses a message: the
 * server's `message` is for a log, and what a person reads is written here where
 * it can be about them.
 */

/** What to say about a failure. */
export interface ErrorStateProps {
  readonly error: unknown;
}

/**
 * Turn a failure into something worth reading.
 *
 * @param error - What was thrown. Anything at all; an unrecognised failure gets
 *   the general wording rather than being shown raw.
 * @returns The sentence to render.
 */
export function describe(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Chronologity could not reach the service. Check your connection and try again.";
  }

  switch (error.code) {
    case "PROVIDER_UNAVAILABLE":
      // Not emptiness. This is the distinction ADR-151 exists to keep.
      return "Chronologity cannot read your history right now. This is temporary — nothing has been lost.";
    case "RATE_LIMITED":
      return "That was a lot at once. Give it a moment and try again.";
    case "AUTHENTICATION_FAILED":
      return "You have been signed out. Sign in to continue.";
    case "ONBOARDING_REQUIRED":
      // Signed in, but without an account yet — a different situation from
      // being signed out, and the one code with a mandatory distinct behaviour.
      return "There is one more step before your Timeline is ready.";
    case "AUTHORIZATION_DENIED":
      return "This is not yours to see.";
    case "CONCURRENCY_CONFLICT":
      return "Somebody changed this while you were looking at it. Reload to see the current version.";
    case "VALIDATION_FAILED":
      return "That request was not something Chronologity could act on.";
    case "NOT_FOUND":
      // Deliberately not "it does not exist". A 404 can mean withheld, and
      // saying otherwise would answer a question the server declined to.
      return "This is not available.";
    default:
      return "Something went wrong. Try again.";
  }
}

/**
 * Show a failure.
 *
 * @param props - The error to describe.
 * @returns The element.
 */
export function ErrorState({ error }: ErrorStateProps): React.JSX.Element {
  return (
    <View style={styles.container} testID="error-state">
      <Text style={styles.body}>{describe(error)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: "#444", textAlign: "center" },
  container: { alignItems: "center", justifyContent: "center", padding: 32 },
});
