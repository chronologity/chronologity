import type { Session } from "@chronologity/api-client";
import { GraphqlError, createGraphqlClient } from "./client";

const session = (token: string | undefined): Session =>
  ({
    accessToken: async () => token,
    current: () => undefined,
    adopt: () => undefined,
    clear: () => undefined,
    refresh: async () => false,
  }) as Session;

const answering = (body: unknown, status = 200) =>
  jest.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );

describe("reading history over GraphQL", () => {
  it("presents the same credential the REST client uses", async () => {
    let sent: string | null = null;
    const client = createGraphqlClient({
      url: "http://localhost:4000",
      session: session("at_live"),
      fetch: async (_input, init) => {
        sent = new Headers(init?.headers).get("authorization");

        return new Response(JSON.stringify({ data: { viewer: { authenticated: true } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await client.query("query { viewer { authenticated } }");

    expect(sent).toBe("Bearer at_live");
  });

  it("posts to the aggregator's graphql route", async () => {
    let url = "";
    const client = createGraphqlClient({
      url: "http://localhost:4000/",
      session: session("at_live"),
      fetch: async (input) => {
        url = String(input);

        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await client.query("query { viewer { authenticated } }");

    expect(url).toBe("http://localhost:4000/graphql");
  });

  it("throws on a GraphQL error rather than returning an empty answer", async () => {
    // The transport answers 200 with an `errors` array. A caller reading `data`
    // alone would see nothing and conclude there is nothing — which is exactly
    // the confusion ADR-151 exists to prevent.
    const client = createGraphqlClient({
      url: "http://localhost:4000",
      session: session("at_live"),
      fetch: answering({ errors: [{ message: "Cost limit exceeded" }] }) as unknown as typeof fetch,
    });

    await expect(client.query("query { timeline { edges { cursor } } }")).rejects.toThrow(
      GraphqlError,
    );
  });

  it("treats errors beside data as a failure, not a partial answer", async () => {
    const client = createGraphqlClient({
      url: "http://localhost:4000",
      session: session("at_live"),
      fetch: answering({
        data: { timeline: { edges: [] } },
        errors: [{ message: "one resolver failed" }],
      }) as unknown as typeof fetch,
    });

    await expect(client.query("query { timeline { edges { cursor } } }")).rejects.toThrow(
      "one resolver failed",
    );
  });

  it("surfaces a refusal rather than downgrading to anonymous", async () => {
    // ADR-137: a credential that fails is refused. A client silently shown an
    // anonymous Timeline would render somebody's history as though it shrank.
    const client = createGraphqlClient({
      url: "http://localhost:4000",
      session: session(undefined),
      fetch: answering({}, 401) as unknown as typeof fetch,
    });

    await expect(client.query("query { viewer { authenticated } }")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("sends no credential when there is none, rather than an empty one", async () => {
    let header: string | null = "unset";
    const client = createGraphqlClient({
      url: "http://localhost:4000",
      session: session(undefined),
      fetch: async (_input, init) => {
        header = new Headers(init?.headers).get("authorization");

        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await client.query("query { viewer { authenticated } }");

    expect(header).toBeNull();
  });

  it("refuses a 200 that carries neither data nor errors", async () => {
    const client = createGraphqlClient({
      url: "http://localhost:4000",
      session: session("at_live"),
      fetch: answering({}) as unknown as typeof fetch,
    });

    await expect(client.query("query { viewer { authenticated } }")).rejects.toThrow(GraphqlError);
  });
});
