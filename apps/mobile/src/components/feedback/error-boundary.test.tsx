import { render } from "@testing-library/react-native";
import { Text } from "react-native";
import { ErrorBoundary } from "./error-boundary";

/**
 * React logs a caught render error to the console. Silencing it keeps the
 * output readable without suppressing anything the test relies on.
 */
const quiet = () => jest.spyOn(console, "error").mockImplementation(() => undefined);

/**
 * A component that always throws.
 *
 * @returns Never.
 * @throws {Error} Always.
 */
function Exploding(): React.JSX.Element {
  throw new Error("secret-bearing failure with a token in it");
}

describe("keeping a render failure from becoming a blank screen", () => {
  it("renders its children when nothing is wrong", async () => {
    const { getByText } = await render(
      <ErrorBoundary>
        <Text>the application</Text>
      </ErrorBoundary>,
    );

    expect(getByText("the application")).toBeTruthy();
  });

  it("shows the fallback when a child throws", async () => {
    const spy = quiet();

    const { getByTestId } = await render(
      <ErrorBoundary>
        <Exploding />
      </ErrorBoundary>,
    );

    expect(getByTestId("error-boundary-fallback")).toBeTruthy();
    spy.mockRestore();
  });

  it("never shows the error's own text", async () => {
    // What is on screen can be photographed and shared. The reasoning behind
    // observability.md:1556-1562's scrubbing applies more strongly here than to
    // a crash report.
    const spy = quiet();

    const { queryByText } = await render(
      <ErrorBoundary>
        <Exploding />
      </ErrorBoundary>,
    );

    expect(queryByText(/secret-bearing/)).toBeNull();
    spy.mockRestore();
  });

  it("hands the error to a reporter without rendering it", async () => {
    const spy = quiet();
    const seen: string[] = [];

    await render(
      <ErrorBoundary onError={(error) => seen.push(error.message)}>
        <Exploding />
      </ErrorBoundary>,
    );

    expect(seen).toEqual(["secret-bearing failure with a token in it"]);
    spy.mockRestore();
  });

  it("offers a way back rather than only an apology", async () => {
    const spy = quiet();

    const { getByRole } = await render(
      <ErrorBoundary>
        <Exploding />
      </ErrorBoundary>,
    );

    expect(getByRole("button")).toBeTruthy();
    spy.mockRestore();
  });
});
