import { render } from "@testing-library/react-native";
import { typography } from "../../app/theme/typography";
import { AppText } from "./app-text";

describe("rendering words", () => {
  it("never caps how far text may scale", async () => {
    // accessibility.md:868 forbids shrinking text back to an inaccessible size,
    // and `maxFontSizeMultiplier` is how a React Native app does exactly that.
    const { getByText } = await render(<AppText>The last morning at the old house.</AppText>);

    expect(getByText("The last morning at the old house.").props.maxFontSizeMultiplier).toBe(
      undefined,
    );
  });

  it("leaves platform font scaling on", async () => {
    const { getByText } = await render(<AppText>Scales</AppText>);

    // React Native scales by default; the failure mode is somebody turning it
    // off, so the assertion is that nobody has.
    expect(getByText("Scales").props.allowFontScaling).not.toBe(false);
  });

  it("takes size, weight and line height together from the variant", async () => {
    const { getByText } = await render(<AppText variant="display">A year</AppText>);

    const style = (getByText("A year").props.style as Array<Record<string, unknown>>).flat();

    expect(style.some((one) => one?.fontSize === typography.display.fontSize)).toBe(true);
    expect(style.some((one) => one?.lineHeight === typography.display.lineHeight)).toBe(true);
  });

  it("has no way to be given a colour that was never measured", async () => {
    // There is no `color="#999"` prop. The type only admits roles, and every
    // role is covered by contrast.test.ts. This asserts the default resolves to
    // an actual value rather than undefined.
    const { getByText } = await render(<AppText color="textMuted">Not yours to read</AppText>);

    const style = (
      getByText("Not yours to read").props.style as Array<Record<string, unknown>>
    ).flat();

    expect(style.some((one) => typeof one?.color === "string")).toBe(true);
  });
});
