import { render } from "@testing-library/react-native";
import { AppInput } from "./app-input";

describe("asking somebody to type something", () => {
  it("draws the label, so it does not vanish when they start typing", async () => {
    // The defect this component exists to make impossible. The sign-in screen
    // named its fields with `placeholder` alone (accessibility.md:774).
    const { getByText } = await render(<AppInput label="Email" testID="email" value="" />);

    expect(getByText("Email")).toBeTruthy();
  });

  it("keeps the label while there is a value in the field", async () => {
    const { getByText } = await render(
      <AppInput label="Email" testID="email" value="rowan@example.test" />,
    );

    expect(getByText("Email")).toBeTruthy();
  });

  it("names the field for a screen reader with the same words", async () => {
    const { getByTestId } = await render(<AppInput label="Password" testID="password" value="" />);

    expect(getByTestId("password").props.accessibilityLabel).toBe("Password");
  });

  it("treats a placeholder as a hint, never as the name", async () => {
    const { getByText, getByTestId } = await render(
      <AppInput label="Date of birth" placeholder="YYYY-MM-DD" testID="dob" value="" />,
    );

    expect(getByText("Date of birth")).toBeTruthy();
    expect(getByTestId("dob").props.placeholder).toBe("YYYY-MM-DD");
    expect(getByTestId("dob").props.accessibilityLabel).not.toBe("YYYY-MM-DD");
  });

  it("shows an error in words, not only in red", async () => {
    // accessibility.md:785 — an error must not be indicated only through red
    // colouring.
    const { getByText } = await render(
      <AppInput error="Enter an email address" label="Email" testID="email" value="not-an-email" />,
    );

    expect(getByText("Enter an email address")).toBeTruthy();
  });

  it("announces an error rather than only drawing it", async () => {
    const { getByTestId } = await render(
      <AppInput error="Enter an email address" label="Email" testID="email" value="x" />,
    );

    expect(getByTestId("email-error").props.accessibilityLiveRegion).toBe("polite");
  });

  it("ties the error to the field it is about", async () => {
    const { getByTestId } = await render(
      <AppInput error="Enter an email address" label="Email" testID="email" value="x" />,
    );

    expect(getByTestId("email").props.accessibilityLabelledBy).toBeDefined();
  });

  it("shows nothing where there is no error", async () => {
    const { queryByTestId } = await render(<AppInput label="Email" testID="email" value="" />);

    expect(queryByTestId("email-error")).toBeNull();
  });

  it("treats an empty error string as no error", async () => {
    const { queryByTestId } = await render(
      <AppInput error="" label="Email" testID="email" value="" />,
    );

    expect(queryByTestId("email-error")).toBeNull();
  });
});
