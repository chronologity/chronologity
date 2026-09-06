/**
 * Distance.
 *
 * A four-point scale, because it divides evenly into the platform's own metrics
 * and because a scale with a step between every pair of values is not a scale.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * The smallest a control may be.
 *
 * **44, and this is a decision rather than a convention followed.**
 * `accessibility.md:878` requires that "Interactive targets should be large
 * enough to operate without high motor precision" and `:891` that "Visually
 * compact design must not create inaccessible hit targets" — but the document
 * names no number, and asks for one at `:1494`. This is that number.
 *
 * 44 rather than Android's 48 because it is the smaller of the two platform
 * floors and a single value that satisfies both is worth more than two that
 * drift. `AppPressable` reaches it with `hitSlop` where the visible control is
 * smaller, so a compact design stays possible and stays operable.
 */
export const MIN_TOUCH_TARGET = 44;
