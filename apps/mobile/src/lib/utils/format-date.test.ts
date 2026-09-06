import { formatOccurrence, formatTimeOfDay } from "./format-date";

const reader = { locale: "en-GB", timeZone: "Europe/London" };

describe("saying when something happened", () => {
  it("gives a day for something known to the instant", () => {
    expect(formatOccurrence("2019-06-14T07:20:00.000Z", "INSTANT", reader)).toBe("14 June 2019");
  });

  it("gives a day for something known to the day", () => {
    expect(formatOccurrence("2019-06-14T00:00:00.000Z", "DAY", reader)).toBe("14 June 2019");
  });

  it("never invents a day for something known only to the month", () => {
    // "summer 1998" is a month-precision interval and never acquires a
    // fabricated timestamp (moments.md:583). Rendering a day would be the
    // product creating false precision.
    const shown = formatOccurrence("1998-06-01T00:00:00.000Z", "MONTH", reader);

    expect(shown).toBe("June 1998");
    expect(shown).not.toMatch(/\d{1,2}\s+June/);
  });

  it("never invents a month for something known only to the year", () => {
    const shown = formatOccurrence("1969-01-01T00:00:00.000Z", "YEAR", reader);

    expect(shown).toBe("1969");
    expect(shown).not.toMatch(/January/);
  });

  it("reads the way the reader's locale reads", () => {
    const british = formatOccurrence("2019-06-14T07:20:00.000Z", "INSTANT", { locale: "en-GB" });
    const american = formatOccurrence("2019-06-14T07:20:00.000Z", "INSTANT", { locale: "en-US" });

    expect(british).not.toBe(american);
    expect(american).toContain("June 14");
  });

  it("places the occurrence in the reader's own time zone", () => {
    // Late evening in Los Angeles is the next day in London. Which day this
    // shows depends on where the reader is, and that is the point.
    const iso = "2019-06-14T04:00:00.000Z";

    expect(formatOccurrence(iso, "DAY", { locale: "en-GB", timeZone: "Europe/London" })).toBe(
      "14 June 2019",
    );
    expect(formatOccurrence(iso, "DAY", { locale: "en-GB", timeZone: "America/Los_Angeles" })).toBe(
      "13 June 2019",
    );
  });

  it("follows the device when the reader has stated no preference", () => {
    // Null in the contract means follow the device, which is not the same as
    // any particular value — so this must not throw or default to a guess.
    expect(() => formatOccurrence("2019-06-14T07:20:00.000Z", "INSTANT")).not.toThrow();
    expect(formatOccurrence("2019-06-14T07:20:00.000Z", "INSTANT")).toContain("2019");
  });

  it("refuses noise that merely contains a year", () => {
    // `new Date("summer 1998")` answers 1 January 1998 rather than failing, so
    // a malformed occurrence would reach the screen as a confident wrong date.
    expect(() => formatOccurrence("summer 1998", "MONTH", reader)).toThrow(RangeError);
    expect(() => formatOccurrence("1998", "YEAR", reader)).toThrow(RangeError);
  });

  it("refuses something that is not a date at all", () => {
    expect(() => formatOccurrence("banana", "DAY", reader)).toThrow(RangeError);
  });

  it("refuses a date with no time zone, which the contracts never send", () => {
    expect(() => formatOccurrence("2019-06-14T07:20:00.000", "INSTANT", reader)).toThrow(
      RangeError,
    );
  });

  it("accepts an offset as well as a Z", () => {
    expect(formatOccurrence("2019-06-14T08:20:00.000+01:00", "DAY", reader)).toBe("14 June 2019");
  });
});

describe("saying what time of day it was", () => {
  it("tells the time for something known to the instant", () => {
    expect(formatTimeOfDay("2019-06-14T07:20:00.000Z", "INSTANT", reader)).toBe("08:20");
  });

  it("tells no time for something known only to the day", () => {
    // There is no time of day to state, and stating one would invent it.
    expect(formatTimeOfDay("2019-06-14T00:00:00.000Z", "DAY", reader)).toBeUndefined();
  });

  it("tells no time for a month or a year", () => {
    expect(formatTimeOfDay("1998-06-01T00:00:00.000Z", "MONTH", reader)).toBeUndefined();
    expect(formatTimeOfDay("1969-01-01T00:00:00.000Z", "YEAR", reader)).toBeUndefined();
  });

  it("works for an occurrence carrying no offset of its own", () => {
    // A withheld entry has no `occurrenceOffsetMinutes` (ADR-140), so it is
    // placed by the reader's zone alone. That is a supported case, not a defect.
    expect(formatOccurrence("2019-06-15T09:00:00.000Z", "DAY", reader)).toBe("15 June 2019");
  });
});
