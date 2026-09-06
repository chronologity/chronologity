import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "../../app/theme/spacing";
import { useTheme } from "../../hooks/use-theme";

/**
 * The ground a screen stands on.
 *
 * Two things every screen needs and every screen would otherwise repeat: the
 * page colour for the current appearance, and the platform's safe-area insets.
 *
 * **Insets rather than a `SafeAreaView`.** A view that pads all four edges is
 * wrong for anything that should reach the bottom of the display — a scrolling
 * Timeline, a full-bleed photograph — and the designs have both. Taking the
 * insets and applying them where they belong keeps that possible.
 */

export interface ScreenProps {
  readonly children: ReactNode;
  /** Whether to inset the content horizontally. Off for full-bleed media. */
  readonly padded?: boolean;
  /** Centre the content, for the states that are one short sentence. */
  readonly centred?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

/**
 * Render a screen.
 *
 * @param props - Its contents and how they sit on the page.
 * @returns The element.
 */
export function Screen({
  children,
  padded = true,
  centred = false,
  style,
  testID,
}: ScreenProps): React.JSX.Element {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const base: ViewStyle = {
    backgroundColor: theme.colors.background,
    flex: 1,
    paddingTop: insets.top,
    ...(padded ? { paddingHorizontal: spacing.lg } : {}),
    ...(centred ? { alignItems: "center", justifyContent: "center" } : {}),
  };

  return (
    <View style={[base, style]} testID={testID}>
      {children}
    </View>
  );
}
