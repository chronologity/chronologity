import { isIdentifier, parseMomentId } from "./linking";

describe("deciding what a link from outside may mean", () => {
  it("accepts an identifier the API would have issued", () => {
    expect(parseMomentId("7ea1c1f4-1b1e-4c7b-9d5e-2a4f9c8b1d30")).toBe(
      "7ea1c1f4-1b1e-4c7b-9d5e-2a4f9c8b1d30",
    );
  });

  it("decodes before deciding", () => {
    expect(parseMomentId("7ea1c1f4-1b1e-4c7b-9d5e-2a4f9c8b1d30%0A")).toBeUndefined();
  });

  it("refuses something that is not an identifier at all", () => {
    // A link is untrusted input. This one should fail here, as a link that does
    // not open, rather than travel onwards as a request nobody meant to make.
    expect(parseMomentId("../../admin")).toBeUndefined();
    expect(parseMomentId("1 OR 1=1")).toBeUndefined();
    expect(parseMomentId("")).toBeUndefined();
  });

  it("refuses an identifier of the wrong shape", () => {
    expect(isIdentifier("7ea1c1f4-1b1e-4c7b-9d5e")).toBe(false);
    expect(isIdentifier("7ea1c1f4_1b1e_4c7b_9d5e_2a4f9c8b1d30")).toBe(false);
  });

  it("refuses a nil identifier, which names nothing", () => {
    expect(isIdentifier("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("says nothing about whether the reader may see it", () => {
    // The whole point: a well-formed identifier parses, and that is all it
    // does. Whether this Moment exists or may be read is the server's answer,
    // re-earned on arrival (privacy.md:432-442).
    expect(isIdentifier("7ea1c1f4-1b1e-4c7b-9d5e-2a4f9c8b1d30")).toBe(true);
  });
});
