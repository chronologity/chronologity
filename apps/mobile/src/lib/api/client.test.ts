import { operations } from "@chronologity/api-client";
import { createBackend } from "./client";
import { forgetSession, rememberSession } from "../storage/secure-storage";

jest.mock("../storage/secure-storage");
jest.mock("expo-crypto", () => ({ randomUUID: () => "trace-from-expo-crypto" }));

const remembered = rememberSession as jest.MockedFunction<typeof rememberSession>;
const forgotten = forgetSession as jest.MockedFunction<typeof forgetSession>;

const ok = () =>
  new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const credentials = {
  sessionId: "0c8f3a21-77b6-4e59-a1d4-5b9e2c7f8a03",
  accessToken: "at_first",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshToken: "rt_first",
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

describe("wiring the client to the Session it carries", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    remembered.mockResolvedValue(true);
    forgotten.mockResolvedValue(undefined);
  });

  it("sends a trace identifier the runtime could not have produced itself", async () => {
    // React Native has no global `crypto`; without expo-crypto the header is
    // omitted and a request cannot be followed into the server's logs.
    let sent: string | null = null;
    const { client } = createBackend({
      apiUrl: "http://localhost:3000",
      feedUrl: "http://localhost:4000",
      fetch: async (_input, init) => {
        sent = new Headers(init?.headers).get("x-trace-id");

        return ok();
      },
    });

    await operations.health.checkLiveness(client, {});

    expect(sent).toBe("trace-from-expo-crypto");
  });

  it("picks up a token adopted after the client was built", async () => {
    // The token supplier is a callback for exactly this reason. If it captured
    // a value, a screen holding this client would keep sending a retired token.
    let sent: string | null = null;
    const { client, session } = createBackend({
      apiUrl: "http://localhost:3000",
      feedUrl: "http://localhost:4000",
      fetch: async (_input, init) => {
        sent = new Headers(init?.headers).get("authorization");

        return ok();
      },
    });

    session.adopt(credentials);
    await operations.health.checkLiveness(client, {});

    expect(sent).toBe("Bearer at_first");
  });

  it("writes only the refresh half through to storage", async () => {
    const { session } = createBackend({
      apiUrl: "http://localhost:3000",
      feedUrl: "http://localhost:4000",
    });

    session.adopt(credentials);
    await Promise.resolve();

    expect(remembered).toHaveBeenCalledWith({
      sessionId: credentials.sessionId,
      refreshToken: credentials.refreshToken,
      refreshTokenExpiresAt: credentials.refreshTokenExpiresAt,
    });
  });

  it("forgets the stored credential when the Session ends", async () => {
    const { session } = createBackend({
      apiUrl: "http://localhost:3000",
      feedUrl: "http://localhost:4000",
    });

    session.adopt(credentials);
    session.clear();
    await Promise.resolve();

    expect(forgotten).toHaveBeenCalled();
  });

  it("tells the shell when the signed-in state changes", async () => {
    const seen: Array<string | undefined> = [];

    const { session } = createBackend({
      apiUrl: "http://localhost:3000",
      feedUrl: "http://localhost:4000",
      onChange: (next) => seen.push(next?.sessionId),
    });

    session.adopt(credentials);
    session.clear();

    expect(seen).toEqual([credentials.sessionId, undefined]);
  });

  it("starts from credentials recovered on a cold start", async () => {
    const { session } = createBackend({
      apiUrl: "http://localhost:3000",
      feedUrl: "http://localhost:4000",
      credentials,
    });

    expect(session.current()?.sessionId).toBe(credentials.sessionId);
  });
});
