import { View } from "react-native";
import { spacing } from "../../app/theme/spacing";
import { AppText } from "../primitives/app-text";

/**
 * Nothing here, and what to do about it.
 *
 * **Two sentences, not one.** `accessibility.md:814` asks that empty states
 * "explain what is absent and what the User can do next", and gives the example
 * of "No Moments occurred during this period" being more useful than an empty
 * visual Timeline. A blank screen is not an answer; neither is a shrug.
 *
 * **An empty state is never a failure.** ADR-151 exists because a Timeline whose
 * read failed looks, to a client, exactly like a Timeline with nothing in it —
 * and those mean opposite things to a person. This component is only for the
 * second. `ErrorState` is for the first, and nothing should ever render this
 * because a request went wrong.
 *
 * **What is absent may be absent for reasons nobody may be told.**
 * `accessibility.md:824`: "Privacy- or moderation-caused absence must not reveal
 * information the User is not permitted to know." So the copy a caller passes
 * describes the reader's own view and never speculates about why.
 */

export interface EmptyStateProps {
  /** What is not here. One short sentence. */
  readonly title: string;
  /** What the reader can do about it. */
  readonly action?: string;
  readonly testID?: string;
}

/**
 * Render an empty state.
 *
 * @param props - What is absent, and optionally what to do next.
 * @returns The element.
 */
export function EmptyState({ title, action, testID }: EmptyStateProps): React.JSX.Element {
  return (
    <View
      accessibilityRole="summary"
      accessible
      style={{ alignItems: "center", gap: spacing.sm, padding: spacing.xxl }}
      testID={testID}
    >
      <AppText style={{ textAlign: "center" }} variant="title">
        {title}
      </AppText>
      {action === undefined ? null : (
        <AppText color="textSecondary" style={{ textAlign: "center" }} variant="secondary">
          {action}
        </AppText>
      )}
    </View>
  );
}
