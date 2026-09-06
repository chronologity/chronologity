import { render } from "@testing-library/react-native";
import { MIN_TOUCH_TARGET } from "../../app/theme/spacing";
import { AppPressable, slopFor } from "./app-pressable";
import { AppText } from "./app-text";

describe("making a control findable by a finger", () => {
  it("extends a small control's touch area up to the floor", () => {
    // The point of the component. A control drawn 28 tall is padded by eight on
    // each side and measures 44 to a finger, without becoming 44 tall on screen.
    expect(slopFor(28)).toBe(8);
    expect(28 + slopFor(28) * 2).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it("adds nothing to a control that already meets the floor", () => {
    expect(slopFor(MIN_TOUCH_TARGET)).toBe(0);
    expect(slopFor(60)).toBe(0);
  });

  it("rounds up rather than down", () => {
    // An odd shortfall must not land a pixel short of the floor.
    expect(29 + slopFor(29) * 2).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(43 + slopFor(43) * 2).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it("assumes the floor when no drawn size is given", () => {
    expect(slopFor(undefined)).toBe(0);
  });

  it("carries a role and the name it was given", async () => {
    const { getByRole } = await render(
      <AppPressable accessibilityLabel="Sign in" onPress={() => undefined}>
        <AppText>Sign in</AppText>
      </AppPressable>,
    );

    expect(getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("says when it is disabled rather than only looking it", async () => {
    const { getByRole } = await render(
      <AppPressable accessibilityLabel="Sign in" disabled onPress={() => undefined}>
        <AppText>Sign in</AppText>
      </AppPressable>,
    );

    expect(getByRole("button", { name: "Sign in" }).props.accessibilityState.disabled).toBe(true);
  });

  it("is at least the floor tall when no smaller size is declared", async () => {
    const { getByRole } = await render(
      <AppPressable accessibilityLabel="Sign in" onPress={() => undefined}>
        <AppText>Sign in</AppText>
      </AppPressable>,
    );

    const style = getByRole("button", { name: "Sign in" }).props.style as Array<
      Record<string, unknown>
    >;

    expect(style.flat().some((one) => one?.minHeight === MIN_TOUCH_TARGET)).toBe(true);
  });
});
