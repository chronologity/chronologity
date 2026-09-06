import { ActivityIndicator, View, type ViewStyle } from "react-native";
import { spacing } from "../../app/theme/spacing";
import { useTheme } from "../../hooks/use-theme";
import { AppText } from "./app-text";

/**
 * Waiting.
 *
 * **A spinner alone is not a loading state.** `accessibility.md:804-806`:
 * "Loading states must be perceivable. Skeleton screens alone are insufficient
 * for Users who cannot perceive them." A bare `ActivityIndicator` is the same
 * failure in a different shape — it is a picture of waiting, and a person who
 * cannot see it is told nothing at all.
 *
 * So this always carries a label. Visibly when there is room for one, and to
 * assistive technology always: the live region is what turns "something is
 * spinning" into "loading your Timeline", and `accessibility.md:808` asks for
 * exactly that — "Assistive technologies should receive meaningful loading/busy
 * state where appropriate."
 *
 * `accessibility.md:800` is the counterweight: "Status announcements should be
 * useful without becoming excessively noisy." `polite` rather than `assertive`,
 * so it waits its turn instead of interrupting.
 */

export interface AppLoaderProps {
  /**
   * What is being waited for.
   *
   * Required, and specific. "Loading" tells somebody nothing they had not
   * already worked out.
   */
  readonly label: string;
  /** Whether to draw the label as well as announce it. */
  readonly showLabel?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

/**
 * Render a loading state.
 *
 * @param props - What is loading, whether to show the words, and styling.
 * @returns The element.
 */
export function AppLoader({
  label,
  showLabel = true,
  style,
  testID,
}: AppLoaderProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessible
      style={[{ alignItems: "center", gap: spacing.md, justifyContent: "center" }, style]}
      testID={testID}
    >
      <ActivityIndicator color={theme.colors.accent} />
      {showLabel ? (
        <AppText color="textSecondary" variant="secondary">
          {label}
        </AppText>
      ) : null}
    </View>
  );
}
