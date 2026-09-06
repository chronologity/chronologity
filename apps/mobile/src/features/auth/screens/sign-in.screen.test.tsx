import { ApiError, createApiClient, type Session } from "@chronologity/api-client";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

// RNTL 14's `fireEvent` and `render` both return promises: React 19 renders
// concurrently, so nothing an event caused has happened until it settles.
import { Providers } from "../../../app/providers";
import type { Backend } from "../../../lib/api/client";
import type { GraphqlClient } from "../../../lib/graphql/client";
import { SignInScreen } from "./sign-in.screen";

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const credentials = {
  sessionId: "0c8f3a21-77b6-4e59-a1d4-5b9e2c7f8a03",
  accessToken: "at_new",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshToken: "rt_new",
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

/**
 * Render the screen against a client that answers however the test says.
 *
 * @param fetchImpl - What the network does.
 * @returns The render result and what the Session was told to adopt.
 */
async function renderSignIn(fetchImpl: typeof globalThis.fetch) {
  const adopted: unknown[] = [];
  const client = createApiClient({ baseUrl: "http://localhost:3000", fetch: fetchImpl });
  const backend: Backend = {
    client,
    graphql: { query: async () => ({}) as never } as GraphqlClient,
    session: {
      accessToken: async () => undefined,
      current: () => undefined,
      adopt: (next) => adopted.push(next),
      clear: () => undefined,
      refresh: async () => false,
    } as Session,
  };

  const view = await render(
    <Providers backend={backend} credentials={undefined} restoring={false} initialMetrics={METRICS}>
      <SignInScreen client={client} />
    </Providers>,
  );

  return { view, adopted };
}

describe("signing in", () => {
  it("adopts the credentials the server issued", async () => {
    const { view, adopted } = await renderSignIn(
      async () =>
        new Response(JSON.stringify(credentials), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await fireEvent.changeText(view.getByTestId("sign-in-email"), "rowan@example.test");
    await fireEvent.changeText(
      view.getByTestId("sign-in-password"),
      "a-sufficiently-long-password",
    );
    await fireEvent.press(view.getByTestId("sign-in-submit"));

    await waitFor(() => {
      expect(adopted).toEqual([credentials]);
    });
  });

  it("sends what the person typed", async () => {
    let sent = "";
    const { view } = await renderSignIn(async (_input, init) => {
      sent = String(init?.body ?? "");

      return new Response(JSON.stringify(credentials), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await fireEvent.changeText(view.getByTestId("sign-in-email"), "rowan@example.test");
    await fireEvent.changeText(
      view.getByTestId("sign-in-password"),
      "a-sufficiently-long-password",
    );
    await fireEvent.press(view.getByTestId("sign-in-submit"));

    await waitFor(() => {
      expect(JSON.parse(sent).email).toBe("rowan@example.test");
    });
  });

  it("adopts nothing when the server refuses", async () => {
    const { view, adopted } = await renderSignIn(
      async () =>
        new Response(
          JSON.stringify({
            code: "AUTHENTICATION_FAILED",
            message: "Those credentials were not accepted",
            traceId: "0af7651916cd43dd8448eb211c80319c",
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );

    await fireEvent.changeText(view.getByTestId("sign-in-email"), "rowan@example.test");
    await fireEvent.changeText(view.getByTestId("sign-in-password"), "wrong-but-long-enough");
    await fireEvent.press(view.getByTestId("sign-in-submit"));

    await waitFor(() => {
      expect(view.getByTestId("error-state")).toBeTruthy();
    });
    expect(adopted).toEqual([]);
  });

  it("never shows the server's own wording for a refusal", async () => {
    // authentication.md:1156 limits what a refusal may reveal, and the client
    // is not the one deciding what happened either way.
    const { view } = await renderSignIn(
      async () =>
        new Response(
          JSON.stringify({
            code: "AUTHENTICATION_FAILED",
            message: "no such account for rowan@example.test",
            traceId: "0af7651916cd43dd8448eb211c80319c",
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );

    await fireEvent.changeText(view.getByTestId("sign-in-email"), "rowan@example.test");
    await fireEvent.changeText(view.getByTestId("sign-in-password"), "wrong-but-long-enough");
    await fireEvent.press(view.getByTestId("sign-in-submit"));

    await waitFor(() => {
      expect(view.getByTestId("error-state")).toBeTruthy();
    });
    expect(view.queryByText(/no such account/)).toBeNull();
  });

  it("refuses locally what the contract would refuse anyway", async () => {
    // The operation parses the body before sending it, so an empty password
    // never becomes a request. ApiError is imported to prove this is not one.
    const { view, adopted } = await renderSignIn(async () => {
      throw new Error("the network should not have been reached");
    });

    await fireEvent.press(view.getByTestId("sign-in-submit"));

    await waitFor(() => {
      expect(view.getByTestId("error-state")).toBeTruthy();
    });
    expect(adopted).toEqual([]);
    expect(ApiError).toBeDefined();
  });
});
