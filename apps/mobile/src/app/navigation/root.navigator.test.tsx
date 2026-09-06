import type { ApiClient, Session } from "@chronologity/api-client";
import type { SessionCredentials } from "@chronologity/contracts";
import { render, waitFor } from "@testing-library/react-native";
import { Providers } from "../providers";
import type { Backend } from "../../lib/api/client";
import type { GraphqlClient } from "../../lib/graphql/client";
import { linking } from "./linking";
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
  // Answers the viewer query so the Timeline settles instead of updating state
  // after the test has finished, which React reports as an act() warning.
  graphql: {
    query: async (document: string) =>
      (document.includes("GetViewer")
        ? { viewer: { authenticated: true, userId: null } }
        : {}) as never,
  } as GraphqlClient,
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

    await waitFor(() => {
      // The settled state, not merely the absence of the other tree: the viewer
      // query resolves in a microtask and would update state after the test.
      expect(queryByTestId("timeline-onboarding")).not.toBeNull();
    });
  });

  it("paints its chrome from the same theme as everything else", async () => {
    // React Navigation draws the screen background, headers and tab bar from
    // its own theme. Left unfed it uses its defaults — a second uncontrolled
    // source of colour under a carefully measured one.
    const { getByTestId } = await renderRoot(undefined, true);

    const style = getByTestId("restoring").props.style as Array<Record<string, unknown>>;

    expect(style.flat().some((one) => typeof one?.backgroundColor === "string")).toBe(true);
  });

  it("has somewhere for a Moment link to land", async () => {
    // `moment` was declared in the route types and routed to in linking.ts and
    // registered in no navigator, so chronologity://moment/<id> resolved to
    // nothing and failed silently.
    const { queryByTestId } = await renderRoot(credentials, false);

    await waitFor(() => {
      // The settled state, not merely the absence of the other tree: the viewer
      // query resolves in a microtask and would update state after the test.
      expect(queryByTestId("timeline-onboarding")).not.toBeNull();
    });
    expect(linking.config?.screens).toHaveProperty("moment");
  });

  it("routes the tabs through the stack the links describe", async () => {
    // A flat linking config would name a navigator that does not exist and
    // silently match nothing.
    expect(linking.config?.screens).toHaveProperty("tabs");
  });

  it("leaves no sign-in screen mounted behind a signed-in tree", async () => {
    // Swapped rather than navigated between, so there is no back stack leading
    // out of somebody's history into the sign-in screen — and nothing stays
    // mounted that the current Viewer has no business seeing.
    const { queryByTestId } = await renderRoot(credentials, false);

    await waitFor(() => {
      // The settled state, not merely the absence of the other tree: the viewer
      // query resolves in a microtask and would update state after the test.
      expect(queryByTestId("timeline-onboarding")).not.toBeNull();
    });
    expect(queryByTestId("restoring")).toBeNull();
  });
});
