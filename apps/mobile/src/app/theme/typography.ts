import type { TextStyle } from "react-native";

/**
 * Type.
 *
 * **The system typeface, deliberately.** Nothing in `docs/` names a font, and
 * `assets/fonts/` exists in the canonical tree with no description. A custom
 * face is a decision about character that nobody has made, and it costs a
 * download before the first frame — so the platform's own is used until there is
 * a reason. It is also the face that already honours the reader's size setting.
 *
 * **No `maxFontSizeMultiplier`, anywhere, on purpose.** React Native offers one
 * and it is the obvious way to stop a layout breaking at the largest text sizes.
 * `accessibility.md:868` forbids exactly that: "Where very large text
 * fundamentally changes layout, the product should reflow into a more suitable
 * representation rather than shrinking the text back to an inaccessible size."
 * Capping the multiplier is shrinking it back. A layout that breaks at 200% is a
 * layout to fix, not a reader to overrule.
 *
 * Line heights are absolute rather than multipliers because React Native does
 * not scale a `lineHeight` with the font scale, so a ratio that reads well at
 * 100% crushes the text at 200%. Each is set generously enough to survive.
 */

/** What a piece of text is for. Screens name one of these, never a size. */
export type TextVariant = "display" | "title" | "body" | "secondary" | "caption" | "label";

export const typography: Record<TextVariant, TextStyle> = {
  /** Once per screen at most, for the thing the screen is about. */
  display: { fontSize: 28, fontWeight: "700", lineHeight: 36 },
  /** A section, or the heading of a state. */
  title: { fontSize: 20, fontWeight: "600", lineHeight: 28 },
  /** Everything a person actually reads. */
  body: { fontSize: 16, fontWeight: "400", lineHeight: 24 },
  /** Supporting text. Still body copy, so still held to 4.5:1. */
  secondary: { fontSize: 15, fontWeight: "400", lineHeight: 22 },
  /** The smallest text the product uses. Not for anything essential. */
  caption: { fontSize: 13, fontWeight: "400", lineHeight: 18 },
  /** A form field's name, or a control's. */
  label: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
};
