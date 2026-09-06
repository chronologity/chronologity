/**
 * Corners.
 *
 * Three values, which is two more than the application currently distinguishes
 * and enough that a card and a button need not look like the same object.
 */
export const radius = {
  sm: 4,
  md: 8,
  lg: 16,
  /** For anything that should read as a circle regardless of its size. */
  full: 9999,
} as const;
