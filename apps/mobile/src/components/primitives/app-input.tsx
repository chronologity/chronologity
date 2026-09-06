import { useId } from "react";
import { TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { radius } from "../../app/theme/radius";
import { spacing } from "../../app/theme/spacing";
import { typography } from "../../app/theme/typography";
import { useTheme } from "../../hooks/use-theme";
import { AppText } from "./app-text";

/**
 * Somewhere to type.
 *
 * **The label is required and always drawn.** This is the whole reason the
 * component exists. `accessibility.md:774` is unambiguous — "Placeholder text
 * must not substitute for a persistent accessible label" — and the sign-in
 * screen was doing exactly that: `placeholder="Email"` and nothing else, so the
 * only thing naming the field disappeared the moment somebody typed in it. That
 * is worst for the people least able to recover from it, and it was invisible in
 * testing because the tests knew which field was which.
 *
 * A `placeholder` prop still exists, for a *hint* — a format, an example. It is
 * never the name.
 *
 * **An error is associated with the field, not floated near it.**
 * `accessibility.md:776-783` wants a validation error to identify the field,
 * explain the fix, and be announced. So the message renders beneath, is tied to
 * the input by `accessibilityLabelledBy`, and is a live region. It also carries
 * words rather than only a red border — `:785`: "An error must not be indicated
 * only through red coloring."
 */

export interface AppInputProps extends Omit<
  TextInputProps,
  "accessibilityLabel" | "placeholderTextColor"
> {
  /** The field's name. Always drawn, never replaced by the placeholder. */
  readonly label: string;
  /** What is wrong, when something is. */
  readonly error?: string | undefined;
  readonly containerStyle?: ViewStyle;
}

/**
 * Render a labelled field.
 *
 * @param props - Its label, any error, and anything `TextInput` accepts except
 *   the accessible label, which the visible one supplies.
 * @returns The element.
 */
export function AppInput({
  label,
  error,
  containerStyle,
  style,
  testID,
  ...rest
}: AppInputProps): React.JSX.Element {
  const { theme } = useTheme();
  const errorId = useId();
  const invalid = error !== undefined && error !== "";

  return (
    <View style={[{ gap: spacing.xs }, containerStyle]}>
      <AppText color="textSecondary" variant="label">
        {label}
      </AppText>

      <TextInput
        {...rest}
        accessibilityLabel={label}
        accessibilityState={{ disabled: rest.editable === false }}
        placeholderTextColor={theme.colors.textMuted}
        style={[
          {
            ...typography.body,
            backgroundColor: theme.colors.surface,
            borderColor: invalid ? theme.colors.danger : theme.colors.borderStrong,
            borderRadius: radius.md,
            borderWidth: 1,
            color: theme.colors.textPrimary,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
          },
          style,
        ]}
        testID={testID}
        {...(invalid ? { accessibilityLabelledBy: errorId } : {})}
      />

      {invalid ? (
        <AppText
          accessibilityLiveRegion="polite"
          color="danger"
          nativeID={errorId}
          testID={testID === undefined ? undefined : `${testID}-error`}
          variant="caption"
        >
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
