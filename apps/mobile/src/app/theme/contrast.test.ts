import { accent, danger, neutral } from "./colors";
import { BACKGROUND_ROLES, TEXT_ROLES, darkTheme, lightTheme, type Theme } from "./theme";

/**
 * The floor, computed rather than promised.
 *
 * `accessibility.md:1154` is invariant 46: "Text and interactive elements must
 * meet the adopted contrast requirements." Until this file existed the adopted
 * requirement was met by whoever last picked a grey — and `#999` on white, at
 * roughly 2.8:1, was the colour of the row that says a Moment is not yours to
 * read. The one row whose meaning concerns somebody else's privacy was the least
 * legible thing on the screen.
 *
 * `accessibility.md:1661` asks for exactly this: accessibility "must be
 * testable… without relying exclusively on manual visual inspection."
 */

/** WCAG 2.2 AA, for text below 24px, or below 18.66px bold. */
const BODY_TEXT = 4.5;

/** WCAG 2.2 AA, for user-interface components and meaningful graphics. */
const NON_TEXT = 3;

/**
 * A channel's contribution to relative luminance.
 *
 * @param channel - The channel, 0 to 1.
 * @returns Its linearised value.
 */
function linearise(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/**
 * Relative luminance, as WCAG defines it.
 *
 * @param hex - A colour, `#RRGGBB`.
 * @returns Its luminance, 0 to 1.
 * @throws {Error} If the colour is not six hex digits, which would otherwise
 *   compute a ratio from `NaN` and pass every assertion here.
 */
function luminance(hex: string): number {
  const value = hex.replace("#", "");

  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${hex} is not a six-digit hex colour`);
  }

  const [r, g, b] = [0, 2, 4].map((at) => linearise(parseInt(value.slice(at, at + 2), 16) / 255));

  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/**
 * The contrast ratio between two colours.
 *
 * @param a - One colour.
 * @param b - The other. Order does not matter.
 * @returns The ratio, 1 to 21.
 */
export function contrastRatio(a: string, b: string): number {
  const [brighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return ((brighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

const themes: Theme[] = [lightTheme, darkTheme];

describe("holding every colour pair to the standard this product adopted", () => {
  it.each(themes)("reads body text against every surface in $name", (theme) => {
    const failures: string[] = [];

    for (const text of TEXT_ROLES) {
      for (const surface of BACKGROUND_ROLES) {
        const ratio = contrastRatio(theme.colors[text], theme.colors[surface]);

        if (ratio < BODY_TEXT) {
          failures.push(`${text} on ${surface} is ${ratio.toFixed(2)}:1`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it.each(themes)("reads a filled control's label in $name", (theme) => {
    const ratio = contrastRatio(theme.colors.textInverse, theme.colors.accentSurface);

    expect(ratio).toBeGreaterThanOrEqual(BODY_TEXT);
  });

  it.each(themes)("shows where a control is in $name", (theme) => {
    // A field's outline is the only thing saying the field is there, so it is a
    // user-interface component rather than decoration.
    for (const surface of BACKGROUND_ROLES) {
      expect(
        contrastRatio(theme.colors.borderStrong, theme.colors[surface]),
      ).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });

  it.each(themes)("shows focus in $name", (theme) => {
    for (const surface of BACKGROUND_ROLES) {
      expect(contrastRatio(theme.colors.focusRing, theme.colors[surface])).toBeGreaterThanOrEqual(
        NON_TEXT,
      );
    }
  });

  it("gives both appearances the same vocabulary", () => {
    // A role missing from one appearance is a screen that renders correctly in
    // one and crashes in the other.
    expect(Object.keys(lightTheme.colors).sort()).toEqual(Object.keys(darkTheme.colors).sort());
  });

  it("does not reuse one colour for a foreground and its own background", () => {
    for (const theme of themes) {
      expect(theme.colors.textPrimary).not.toBe(theme.colors.background);
      expect(theme.colors.accentSurface).not.toBe(theme.colors.textInverse);
    }
  });

  it("computes a ratio the way the standard says", () => {
    // Anchors the maths itself. Without these the assertions above would pass
    // just as happily against a function that always returned 21.
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 1);
  });

  it("refuses a colour it cannot measure", () => {
    expect(() => contrastRatio("#FFF", "#000000")).toThrow();
    expect(() => contrastRatio("rebeccapurple", "#000000")).toThrow();
  });

  it("would have caught the grey this replaced", () => {
    // The withheld row was #999 on white. This is the regression the whole file
    // exists for.
    expect(contrastRatio("#999999", "#FFFFFF")).toBeLessThan(BODY_TEXT);
  });

  it("keeps every ramp value measurable", () => {
    // A malformed entry anywhere in the ramps would reach a theme eventually.
    for (const value of [
      ...Object.values(neutral),
      accent.light,
      accent.dark,
      danger.light,
      danger.dark,
    ]) {
      expect(() => contrastRatio(value, "#FFFFFF")).not.toThrow();
    }
  });
});
