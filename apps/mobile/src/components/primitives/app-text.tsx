import { Text, type TextProps, type TextStyle } from "react-native";
import { typography, type TextVariant } from "../../app/theme/typography";
import { useTheme } from "../../hooks/use-theme";
import type { ThemeColors } from "../../app/theme/theme";

/**
 * Words.
 *
 * **Every piece of text in the application comes through here**, which is what
 * makes two guarantees hold without anybody remembering them.
 *
 * The first is scaling. React Native offers `maxFontSizeMultiplier`, and it is
 * the obvious way to stop a layout breaking at the largest text sizes. It is not
 * set here and must not be set anywhere: `accessibility.md:868` says that "Where
 * very large text fundamentally changes layout, the product should reflow into a
 * more suitable representation rather than shrinking the text back to an
 * inaccessible size." Capping the multiplier *is* shrinking it back. A layout
 * that breaks at 200% is a layout to fix.
 *
 * The second is contrast. Colour is named by role, and every role a caller can
 * pass is one `contrast.test.ts` has already measured against every surface it
 * is allowed on. There is no prop that takes a hex code.
 */

/** Which text colours a caller may ask for. */
export type TextColor = Extract<
  keyof ThemeColors,
  "textPrimary" | "textSecondary" | "textMuted" | "textInverse" | "accent" | "danger"
>;

export interface AppTextProps extends TextProps {
  /** What this text is for. Chooses size, weight and line height together. */
  readonly variant?: TextVariant;
  /** Which role's colour. Never a value. */
  readonly color?: TextColor;
}

/**
 * Render text.
 *
 * @param props - The variant, the colour role, and anything `Text` accepts.
 * @returns The element.
 */
export function AppText({
  variant = "body",
  color = "textPrimary",
  style,
  ...rest
}: AppTextProps): React.JSX.Element {
  const { theme } = useTheme();

  const base: TextStyle = {
    ...typography[variant],
    color: theme.colors[color],
  };

  return <Text {...rest} style={[base, style]} />;
}
