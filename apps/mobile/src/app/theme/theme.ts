import { accent, danger, neutral } from "./colors";

/**
 * What the colours are for.
 *
 * **Roles, not values.** A screen asks for `textSecondary` and gets whichever
 * grey is correct in the appearance it happens to be rendering in. That is what
 * makes a second appearance possible at all, and it is also what makes contrast
 * checkable: a role knows the surface it will be read against, and a hex code
 * knows nothing.
 *
 * **Both appearances hold the same floor.** Every text role clears 4.5:1 against
 * every background it is permitted on, and every meaningful boundary clears
 * 3:1 — WCAG 2.2 AA, adopted here because `accessibility.md:1254` asks which
 * target Chronologity will take and `:846` requires "sufficient contrast for the
 * intended accessibility standard" without naming one. `contrast.test.ts`
 * computes every pair and fails the build below the floor, so this is a
 * measurement rather than an intention.
 *
 * **Two kinds of boundary, and the distinction is load-bearing.** `border` is
 * decorative — a divider between rows, where the rows are already distinguished
 * by their content — and carries no contrast floor. `borderStrong` is the only
 * thing saying where a control is, and clears 3:1. Collapsing them would either
 * make every hairline heavy or make an input's outline invisible.
 */

/** Every colour the application may name. */
export interface ThemeColors {
  /** The page. */
  background: string;
  /** A surface raised off the page: a card, a field, a sheet. */
  surface: string;
  /** Anything a person reads. */
  textPrimary: string;
  /** Supporting copy. Still held to the body-text floor. */
  textSecondary: string;
  /** The quietest text the product uses. Still held to the body-text floor. */
  textMuted: string;
  /** Text on top of `accentSurface`. */
  textInverse: string;
  /** A divider whose absence would change nothing. No floor. */
  border: string;
  /** A boundary that carries meaning — a field's outline. At least 3:1. */
  borderStrong: string;
  /** Interactive. The one colour in the product that is not a grey. */
  accent: string;
  /** A filled control's background. */
  accentSurface: string;
  /** Refusal. Never alone: colour may reinforce meaning, never carry it. */
  danger: string;
  /** Focus, for keyboard and switch users. At least 3:1 against its neighbours. */
  focusRing: string;
}

/** One appearance. */
export interface Theme {
  readonly name: "light" | "dark";
  /** True for dark, which React Navigation's own theme also wants. */
  readonly dark: boolean;
  readonly colors: ThemeColors;
}

export const lightTheme: Theme = {
  name: "light",
  dark: false,
  colors: {
    // The page is the warm off-white; a card is white and sits above it. That
    // ordering is what makes a photograph appear to come forward.
    background: neutral[50],
    surface: neutral[0],
    textPrimary: neutral[900],
    textSecondary: neutral[600],
    // A shade darker than it looks like it needs: the lighter grey cleared
    // 4.5:1 on the page and failed it on a card.
    textMuted: neutral[500],
    textInverse: neutral[0],
    border: neutral[200],
    borderStrong: neutral[400],
    accent: accent.light,
    accentSurface: accent.light,
    danger: danger.light,
    focusRing: accent.light,
  },
};

export const darkTheme: Theme = {
  name: "dark",
  dark: true,
  colors: {
    background: neutral[950],
    surface: neutral[800],
    textPrimary: neutral[50],
    textSecondary: neutral[300],
    textMuted: neutral[300],
    textInverse: neutral[900],
    border: neutral[700],
    borderStrong: neutral[300],
    accent: accent.dark,
    accentSurface: accent.dark,
    danger: danger.dark,
    focusRing: accent.dark,
  },
};

/** Which surfaces text is permitted to be read against. */
export const BACKGROUND_ROLES = ["background", "surface"] as const;

/** Roles that carry body copy, and are therefore held to 4.5:1. */
export const TEXT_ROLES = ["textPrimary", "textSecondary", "textMuted", "danger"] as const;
