import { ActivityIndicator, View, type ViewStyle } from "react-native";
import { radius } from "../../app/theme/radius";
import { spacing } from "../../app/theme/spacing";
import { useTheme } from "../../hooks/use-theme";
import { AppPressable } from "./app-pressable";
import { AppText } from "./app-text";

/**
 * A thing to do.
 *
 * Built on `AppPressable`, so the touch floor and the accessible role come for
 * free and cannot be opted out of.
 *
 * **Busy is announced, not only shown.** Swapping the label for a spinner is the
 * ordinary way to do this and it silently removes the control's name: a screen
 * reader that said "Sign in, button" a moment ago now says "button". So the
 * label stays as the accessible name throughout, and `accessibilityState.busy`
 * carries the change.
 *
 * **Busy also disables.** A button that still fires while its own request is in
 * flight submits twice, and this application has no idempotency keys to make
 * that harmless (ADR-154).
 */

export interface AppButtonProps {
  /** What the button says, and what a screen reader calls it. */
  readonly label: string;
  readonly onPress: () => void;
  /** Whether the action this triggers is in flight. */
  readonly busy?: boolean;
  readonly disabled?: boolean;
  /** A quieter button, for anything that is not the screen's main action. */
  readonly tone?: "primary" | "secondary";
  readonly style?: ViewStyle;
  readonly testID?: string;
}

/**
 * Render a button.
 *
 * @param props - Its label, what pressing it does, and its state.
 * @returns The element.
 */
export function AppButton({
  label,
  onPress,
  busy = false,
  disabled = false,
  tone = "primary",
  style,
  testID,
}: AppButtonProps): React.JSX.Element {
  const { theme } = useTheme();
  const primary = tone === "primary";

  const container: ViewStyle = {
    alignItems: "center",
    backgroundColor: primary ? theme.colors.accentSurface : "transparent",
    borderColor: theme.colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: primary ? 0 : 1,
    opacity: disabled ? 0.5 : 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  };

  return (
    <AppPressable
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[container, style]}
      testID={testID}
    >
      {busy ? (
        // Sized so the button does not change height when it becomes busy,
        // which would move everything below it.
        <View style={{ alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={primary ? theme.colors.textInverse : theme.colors.accent} />
        </View>
      ) : (
        <AppText color={primary ? "textInverse" : "accent"} variant="label">
          {label}
        </AppText>
      )}
    </AppPressable>
  );
}
