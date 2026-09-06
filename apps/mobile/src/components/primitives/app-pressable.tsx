import { Pressable, type PressableProps, type ViewStyle } from "react-native";
import { MIN_TOUCH_TARGET } from "../../app/theme/spacing";

/**
 * Something to press.
 *
 * **The floor is not optional and there is no prop to lower it.**
 * `accessibility.md:878` requires that interactive targets be "large enough to
 * operate without high motor precision" and `:891` that "Visually compact design
 * must not create inaccessible hit targets" — but names no number, and asks for
 * one at `:1494`. Forty-four is the answer this product gives (`spacing.ts`).
 *
 * **`hitSlop` rather than a minimum size**, and the difference matters. Forcing
 * every control to be 44 points tall would make a row of small controls into a
 * wall; extending the *touchable* area past the visible one keeps a compact
 * design compact and still operable. A control drawn 28 points tall is padded
 * out by eight on each side and measures 44 to a finger.
 *
 * **An accessible name is required by the type.** A pressable that a screen
 * reader announces as "button" and nothing else is a control nobody can use
 * without sight, and it is the easiest thing in the world to forget — so the
 * name is not optional here, and forgetting it does not compile.
 */

export interface AppPressableProps extends Omit<PressableProps, "accessibilityLabel" | "hitSlop"> {
  /**
   * What a screen reader says this is.
   *
   * Required rather than optional. `accessibility.md:127` expects a person to be
   * able to learn "what each control does" without seeing it.
   */
  readonly accessibilityLabel: string;
  /** How tall the control is drawn, if smaller than the floor. */
  readonly visualHeight?: number;
  /** How wide the control is drawn, if smaller than the floor. */
  readonly visualWidth?: number;
}

/**
 * The slop needed to bring a drawn size up to the floor.
 *
 * @param drawn - How large the control is drawn on that axis.
 * @returns Half the shortfall, so it extends equally on both sides. Zero when
 *   the control already meets the floor.
 */
export function slopFor(drawn: number | undefined): number {
  if (drawn === undefined || drawn >= MIN_TOUCH_TARGET) {
    return 0;
  }

  return Math.ceil((MIN_TOUCH_TARGET - drawn) / 2);
}

/**
 * Render a pressable that a finger can find.
 *
 * @param props - Its accessible name, its drawn size, and anything `Pressable`
 *   accepts except the two this owns.
 * @returns The element.
 */
export function AppPressable({
  accessibilityLabel,
  accessibilityState,
  visualHeight,
  visualWidth,
  style,
  disabled,
  ...rest
}: AppPressableProps): React.JSX.Element {
  const minimum: ViewStyle = {
    justifyContent: "center",
    minHeight: visualHeight ?? MIN_TOUCH_TARGET,
    minWidth: visualWidth ?? undefined,
  };

  return (
    <Pressable
      {...rest}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      // Merged rather than replaced. Setting this outright discarded whatever a
      // caller had said — `AppButton`'s `busy` among it, which is the one thing
      // a screen reader has to hear while a button is spinning.
      accessibilityState={{ ...accessibilityState, disabled: disabled === true }}
      disabled={disabled}
      hitSlop={{
        top: slopFor(visualHeight),
        bottom: slopFor(visualHeight),
        left: slopFor(visualWidth),
        right: slopFor(visualWidth),
      }}
      style={[minimum, style as ViewStyle]}
    />
  );
}
