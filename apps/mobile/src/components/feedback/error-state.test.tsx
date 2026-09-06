import { ApiError } from "@chronologity/api-client";
import { render } from "@testing-library/react-native";
import { ErrorState, describe as describeError } from "./error-state";

const apiError = (code: string, status: number) =>
  new ApiError(status, {
    code: code as never,
    message: "server wording nobody should read",
    traceId: "0af7651916cd43dd8448eb211c80319c",
  });

describe("telling somebody why they are not seeing what they asked for", () => {
  it("says an outage is temporary rather than showing it as emptiness", () => {
    // The distinction ADR-151 exists to keep. Rendering this as an empty
    // Timeline would tell somebody their history had disappeared.
    const words = describeError(apiError("PROVIDER_UNAVAILABLE", 503));

    expect(words).toContain("nothing has been lost");
  });

  it("distinguishes being signed out from having no account yet", () => {
    const signedOut = describeError(apiError("AUTHENTICATION_FAILED", 401));
    const notOnboarded = describeError(apiError("ONBOARDING_REQUIRED", 403));

    expect(signedOut).not.toBe(notOnboarded);
    expect(notOnboarded).not.toContain("Sign in");
  });

  it("does not claim that something withheld does not exist", () => {
    // A 404 can mean withheld. Saying "does not exist" would answer a question
    // the server deliberately declined to.
    const words = describeError(apiError("NOT_FOUND", 404));

    expect(words).not.toMatch(/does not exist|no such/i);
  });

  it("never shows the server's own wording", () => {
    const words = describeError(apiError("INTERNAL_ERROR", 500));

    expect(words).not.toContain("server wording nobody should read");
  });

  it("describes a failure that never reached the server", () => {
    const words = describeError(new TypeError("Network request failed"));

    expect(words).toContain("connection");
  });

  it("renders the sentence it chose", async () => {
    // RNTL 14's render is async: React 19 renders concurrently, so the tree is
    // not there the instant render returns.
    const { getByTestId, getByText } = await render(
      <ErrorState error={apiError("RATE_LIMITED", 429)} />,
    );

    expect(getByTestId("error-state")).toBeTruthy();
    expect(getByText(/give it a moment/i)).toBeTruthy();
  });
});
