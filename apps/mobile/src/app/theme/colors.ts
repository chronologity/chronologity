/**
 * The raw colour ramps.
 *
 * **Nothing outside `theme.ts` should import this file.** These are values, not
 * meanings: a screen that reaches for `neutral[600]` has decided what grey looks
 * right today, and one that asks for `textSecondary` has said what it means. Only
 * the second survives a second appearance, and only the second can be checked —
 * `contrast.test.ts` reasons about roles because a role knows the surface it will
 * be read against, and a hex code knows nothing.
 *
 * **Warm neutrals, and the warmth is the point.** These values were sampled from
 * the product designs rather than invented: the page is `#F9F5F0`, a warm
 * off-white, not the pure white a developer reaches for by default. Against it a
 * photograph reads as a photograph rather than as a bright rectangle cut out of a
 * brighter one, and the whole interface stops looking like a form.
 *
 * The product is people's photographs; chrome that competes with them is chrome
 * in the way. So the only colour here that is not a warm grey is the one accent —
 * and `accessibility.md:848` settles any argument about it: "Chronologity's
 * visual identity must adapt to accessibility requirements rather than treating
 * low-contrast aesthetics as immutable branding."
 *
 * **Every value was measured, not chosen by eye.** Several sit a shade darker
 * than looked right, because the shade that looked right cleared 4.5:1 against
 * the page and failed it against a card.
 */

/**
 * Warm greys, light to dark.
 *
 * `0` is a raised surface and `50` is the page — which is the opposite way round
 * from most palettes, and deliberate. A card is *lighter* than the ground it sits
 * on here, so media appears to come forward rather than being punched out.
 */
export const neutral = {
  /** A raised surface: a card, a media well, a field. */
  0: "#FFFFFF",
  /** The page. */
  50: "#F9F5F0",
  100: "#F1ECE5",
  /** A decorative divider. */
  200: "#E0DAD2",
  300: "#B9B2A8",
  /** The lightest a meaningful boundary may be. */
  400: "#7C756B",
  500: "#675F55",
  600: "#574F46",
  700: "#3A342D",
  /** A raised surface in the dark appearance. */
  800: "#1F1E1E",
  900: "#141210",
  /** The page in the dark appearance. Sampled true black from the designs. */
  950: "#000000",
} as const;

/**
 * The one accent.
 *
 * A saturated blue, sampled from the designs, where it does a specific job: it
 * marks *where in time you are*. The year heading, the tab underline for the
 * Timeline you are reading, the ring around the active Moment, the jump control.
 * It is the colour of orientation, which is why nothing decorative may use it.
 *
 * Two values because a blue readable on warm white is not readable on black. One
 * that survived both would sit in the middle, washed out on one and glaring on
 * the other.
 */
export const accent = {
  light: "#003CF5",
  dark: "#8FB4F5",
} as const;

/**
 * Refusal.
 *
 * Present so error text can be coloured, never so colour can carry the message.
 * `accessibility.md:828` requires that colour "must not be the only way meaning
 * is communicated", and `:785` says outright that "An error must not be
 * indicated only through red coloring." Every use of this sits beside words.
 */
export const danger = {
  light: "#A32017",
  dark: "#F2B8B5",
} as const;
