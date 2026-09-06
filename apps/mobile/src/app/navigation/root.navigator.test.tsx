import type { ApiClient, Session } from "@chronologity/api-client";
import type { SessionCredentials } from "@chronologity/contracts";
import { render } from "@testing-library/react-native";
import { Providers } from "../providers";
import type { Backend } from "../../lib/api/client";
import type { GraphqlClient } from "../../lib/graphql/client";
import { RootNavigator } from "./root.navigator";

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const credentials: SessionCredentials = {
  sessionId: "0c8f3a21-77b6-4e59-a1d4-5b9e2c7f8a03",
  accessToken: "at",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshToken: "rt",
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

const backend: Backend = {
  client: {} as ApiClient,
  graphql: { query: async () => ({}) as never } as GraphqlClient,
  session: {
    accessToken: async () => "at",
    current: () => undefined,
    adopt: () => undefined,
    clear: () => undefined,
    refresh: async () => false,
  } as Session,
};

/**
 * Render the root in one of its three states.
 *
 * @param held - The credentials the Session holds, if any.
 * @param restoring - Whether the cold-start recovery is still running.
 * @returns The render result.
 */
async function renderRoot(held: SessionCredentials | undefined, restoring: boolean) {
  return await render(
    <Providers backend={backend} credentials={held} restoring={restoring} initialMetrics={METRICS}>
      <RootNavigator client={backend.client} />
    </Providers>,
  );
}

describe("choosing which half of the application is showing", () => {
  it("shows neither half while the secure store is still being read", async () => {
    // The third state, and the reason it exists. Treating "not known yet" as
    // "signed out" shows the sign-in screen to somebody who is already signed
    // in — the flicker that makes an app feel like it forgot you.
    const { getByTestId, queryByTestId } = await renderRoot(undefined, true);

    expect(getByTestId("restoring")).toBeTruthy();
    expect(queryByTestId("sign-in-screen")).toBeNull();
  });

  it("shows the sign-in screen when nobody is signed in", async () => {
    const { getByTestId } = await renderRoot(undefined, false);

    expect(getByTestId("sign-in-screen")).toBeTruthy();
  });

  it("shows the Timeline when somebody is", async () => {
    const { queryByTestId } = await renderRoot(credentials, false);

    expect(queryByTestId("sign-in-screen")).toBeNull();
  });

  it("leaves no sign-in screen mounted behind a signed-in tree", async () => {
    // Swapped rather than navigated between, so there is no back stack leading
    // out of somebody's history into the sign-in screen — and nothing stays
    // mounted that the current Viewer has no business seeing.
    const { queryByTestId } = await renderRoot(credentials, false);

    expect(queryByTestId("sign-in-screen")).toBeNull();
    expect(queryByTestId("restoring")).toBeNull();
  });
});
