import type { Session } from "@chronologity/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Providers } from "../../../app/providers";
import type { Backend } from "../../../lib/api/client";
import type { GraphqlClient } from "../../../lib/graphql/client";
import { TimelineScreen } from "./timeline.screen";

const credentials = {
  sessionId: "0c8f3a21-77b6-4e59-a1d4-5b9e2c7f8a03",
  accessToken: "at",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshToken: "rt",
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

const readable = {
  __typename: "ReadableTimelineEntry",
  momentId: "7ea1c1f4-1b1e-4c7b-9d5e-2a4f9c8b1d30",
  occurredAt: "2019-06-14T07:20:00.000Z",
  occurrencePrecision: "INSTANT",
  occurrenceOffsetMinutes: 60,
  visibility: "PUBLIC",
};

const withheld = {
  __typename: "WithheldTimelineEntry",
  momentId: "b2c9d1e0-4a53-4f18-9c72-6d3e8f1a0b45",
  occurredAt: "2019-06-15T09:00:00.000Z",
  occurrencePrecision: "DAY",
};

/** The account the aggregator says is reading. Not the Session identifier. */
const USER_ID = "3f2b7c58-9a41-4d2e-8f6a-1c0b5e7d9a24";

/** Fixed insets. Without them SafeAreaProvider renders nothing off-device. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const page = (nodes: unknown[]) => ({
  timeline: {
    edges: nodes.map((node, index) => ({ cursor: `c${String(index)}`, node })),
    pageInfo: { endCursor: null, hasNextPage: false },
    scope: { type: "PERSON", id: credentials.sessionId },
  },
});

/**
 * A reader that answers the viewer query, then hands the rest to `then`.
 *
 * The screen asks who is signed in before it asks for their history, because a
 * Session identifier is not a person.
 *
 * @param userId - What the aggregator says the reader's account is.
 * @param then - What to answer the Timeline query with.
 * @returns A query function.
 */
function reader(userId: string | null, then: GraphqlClient["query"]): GraphqlClient["query"] {
  return (async (document: string, variables?: Record<string, unknown>, signal?: AbortSignal) => {
    if (document.includes("GetViewer")) {
      return { viewer: { authenticated: true, userId } };
    }

    return await then(document, variables, signal);
  }) as GraphqlClient["query"];
}

/**
 * A backend whose GraphQL reader answers with whatever the test supplies.
 *
 * @param query - What `graphql.query` should do.
 * @returns The backend.
 */
function backendWith(query: GraphqlClient["query"]): Backend {
  return {
    client: {} as Backend["client"],
    graphql: { query } as GraphqlClient,
    session: {
      accessToken: async () => credentials.accessToken,
      current: () => credentials,
      adopt: () => undefined,
      clear: () => undefined,
      refresh: async () => false,
    } as Session,
  };
}

/**
 * Wrap a screen in the providers it needs.
 *
 * @param backend - The backend to expose.
 * @returns A wrapper component.
 */
function wrapper(backend: Backend) {
  const queryClient = new QueryClient({
    // `gcTime: 0` keeps the cache from scheduling a collection the test does
    // not stay alive for, which Jest reports as a leaked handle.
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return function Wrapper({ children }: { children: ReactNode }): React.JSX.Element {
    return (
      <QueryClientProvider client={queryClient}>
        <Providers
          backend={backend}
          credentials={credentials}
          restoring={false}
          initialMetrics={METRICS}
        >
          {children}
        </Providers>
      </QueryClientProvider>
    );
  };
}

describe("showing a page of somebody's own history", () => {
  it("renders the Moments the aggregator returned", async () => {
    const backend = backendWith(reader(USER_ID, async () => page([readable]) as never));

    const { getByTestId } = await render(<TimelineScreen />, { wrapper: wrapper(backend) });

    await waitFor(() => {
      expect(getByTestId("timeline")).toBeTruthy();
    });
  });

  it("renders a withheld Moment as withheld, never as a readable one", async () => {
    // ADR-140 made an unreadable Moment its own type precisely so a client
    // cannot confuse the two. Showing it as readable would be a leak; showing a
    // gap would misstate the shape of the period.
    const backend = backendWith(reader(USER_ID, async () => page([withheld]) as never));

    const { getByTestId, queryByTestId } = await render(<TimelineScreen />, {
      wrapper: wrapper(backend),
    });

    await waitFor(() => {
      expect(getByTestId("timeline-entry-withheld")).toBeTruthy();
    });
    expect(queryByTestId("timeline-entry")).toBeNull();
  });

  it("keeps a withheld Moment in its chronological place", async () => {
    // It is still part of the shape of that period, which is why it has an
    // occurrence at all.
    const backend = backendWith(reader(USER_ID, async () => page([readable, withheld]) as never));

    const { getAllByTestId, getByTestId } = await render(<TimelineScreen />, {
      wrapper: wrapper(backend),
    });

    await waitFor(() => {
      expect(getByTestId("timeline")).toBeTruthy();
    });
    expect(getAllByTestId(/timeline-entry/).length).toBe(2);
  });

  it("says a Timeline is empty only when it is", async () => {
    const backend = backendWith(reader(USER_ID, async () => page([]) as never));

    const { getByTestId } = await render(<TimelineScreen />, { wrapper: wrapper(backend) });

    await waitFor(() => {
      expect(getByTestId("timeline-empty")).toBeTruthy();
    });
  });

  it("scopes the Timeline to the account, never to the Session", async () => {
    // A Session identifier names one sign-in on one device. Scoping a PERSON
    // Timeline to it asks for the history of somebody who does not exist.
    let scoped: unknown;
    const backend = backendWith(
      reader(USER_ID, async (_document, variables) => {
        scoped = (variables?.view as { scope?: { id?: string } })?.scope?.id;

        return page([]) as never;
      }),
    );

    const { getByTestId } = await render(<TimelineScreen />, { wrapper: wrapper(backend) });

    await waitFor(() => {
      expect(getByTestId("timeline-empty")).toBeTruthy();
    });
    expect(scoped).toBe(USER_ID);
    expect(scoped).not.toBe(credentials.sessionId);
  });

  it("sends somebody without an account to onboarding, not back to signing in", async () => {
    // `userId` null means signed in and not yet onboarded (ADR-139). The
    // credentials are good; there is simply no history to scope to.
    const backend = backendWith(reader(null, async () => page([]) as never));

    const { getByTestId, queryByTestId } = await render(<TimelineScreen />, {
      wrapper: wrapper(backend),
    });

    await waitFor(() => {
      expect(getByTestId("timeline-onboarding")).toBeTruthy();
    });
    expect(queryByTestId("timeline-empty")).toBeNull();
  });

  it("does not crash on an answer that is missing the field it asked for", async () => {
    // A GraphQL response is not parsed the way a REST one is, so an absent
    // field arrives as undefined rather than as a refusal. Reaching through it
    // took the whole screen down, which is worse than any error state.
    const backend = backendWith((async () => ({})) as GraphqlClient["query"]);

    const { getByTestId, queryByTestId } = await render(<TimelineScreen />, {
      wrapper: wrapper(backend),
    });

    expect(getByTestId("timeline-loading")).toBeTruthy();
    expect(queryByTestId("timeline-onboarding")).toBeNull();

    // The query settles after the assertions above, and a state update after a
    // test finishes is what React reports as an act() warning. Waiting for the
    // state it settles into keeps the run's output honest.
    await waitFor(() => {
      expect(getByTestId("timeline-loading")).toBeTruthy();
    });
  });

  it("shows an outage as an outage rather than as an empty Timeline", async () => {
    // The distinction ADR-151 exists for. This is the rendering half of it.
    const backend = backendWith(
      reader(USER_ID, async () => {
        throw new Error("the service is unwell");
      }),
    );

    const { getByTestId, queryByTestId } = await render(<TimelineScreen />, {
      wrapper: wrapper(backend),
    });

    await waitFor(() => {
      expect(getByTestId("error-state")).toBeTruthy();
    });
    expect(queryByTestId("timeline-empty")).toBeNull();
  });
});
