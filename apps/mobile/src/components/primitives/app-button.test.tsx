import { fireEvent, render } from "@testing-library/react-native";
import { AppButton } from "./app-button";
import { AppLoader } from "./app-loader";

describe("offering something to do", () => {
  it("keeps its name while it is busy", async () => {
    // Swapping the label for a spinner is the ordinary way to show busy, and it
    // silently removes the control's name from a screen reader.
    const { getByRole } = await render(
      <AppButton busy label="Sign in" onPress={() => undefined} testID="submit" />,
    );

    expect(getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("says it is busy rather than only spinning", async () => {
    const { getByTestId } = await render(
      <AppButton busy label="Sign in" onPress={() => undefined} testID="submit" />,
    );

    expect(getByTestId("submit").props.accessibilityState.busy).toBe(true);
  });

  it("cannot be pressed twice while its request is in flight", async () => {
    // There are no idempotency keys in this system (ADR-154), so a second
    // submission is a second thing recorded.
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <AppButton busy label="Sign in" onPress={onPress} testID="submit" />,
    );

    await fireEvent.press(getByTestId("submit"));

    expect(onPress).not.toHaveBeenCalled();
  });

  it("presses when it is not busy", async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <AppButton label="Sign in" onPress={onPress} testID="submit" />,
    );

    await fireEvent.press(getByTestId("submit"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not press when disabled", async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <AppButton disabled label="Sign in" onPress={onPress} testID="submit" />,
    );

    await fireEvent.press(getByTestId("submit"));

    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("saying that something is loading", () => {
  it("announces what is loading, not merely that something is", async () => {
    // accessibility.md:806 — a picture of waiting tells somebody who cannot see
    // it nothing at all.
    const { getByTestId } = await render(
      <AppLoader label="Loading your Timeline" testID="loading" />,
    );

    expect(getByTestId("loading").props.accessibilityLabel).toBe("Loading your Timeline");
    expect(getByTestId("loading").props.accessibilityRole).toBe("progressbar");
  });

  it("waits its turn instead of interrupting", async () => {
    // accessibility.md:800 — useful without becoming excessively noisy.
    const { getByTestId } = await render(<AppLoader label="Loading" testID="loading" />);

    expect(getByTestId("loading").props.accessibilityLiveRegion).toBe("polite");
  });

  it("can be drawn without visible words but never without spoken ones", async () => {
    const { getByTestId, queryByText } = await render(
      <AppLoader label="Signing in" showLabel={false} testID="loading" />,
    );

    expect(queryByText("Signing in")).toBeNull();
    expect(getByTestId("loading").props.accessibilityLabel).toBe("Signing in");
  });
});
