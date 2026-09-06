import { recallSession } from "../storage/secure-storage";
import { restoreSession } from "./session";

jest.mock("../storage/secure-storage");

const recalled = recallSession as jest.MockedFunction<typeof recallSession>;

const stored = {
  sessionId: "0c8f3a21-77b6-4e59-a1d4-5b9e2c7f8a03",
  refreshToken: "rt_5f8a1c9d2e6b4a70c3d5e8f1a2b4c6d8",
  refreshTokenExpiresAt: "2026-10-01T11:15:00.000Z",
};

const beforeExpiry = () => Date.parse("2026-09-06T00:00:00.000Z");
const afterExpiry = () => Date.parse("2026-11-01T00:00:00.000Z");

describe("recovering a Session on a cold start", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("starts signed out when nothing was stored", async () => {
    recalled.mockResolvedValue(undefined);

    expect(await restoreSession(beforeExpiry)).toEqual({ credentials: undefined });
  });

  it("recovers the Session identity and its refresh credential", async () => {
    recalled.mockResolvedValue(stored);

    const { credentials } = await restoreSession(beforeExpiry);

    expect(credentials?.sessionId).toBe(stored.sessionId);
    expect(credentials?.refreshToken).toBe(stored.refreshToken);
  });

  it("hands back an access token that is already expired", async () => {
    // The point of the whole module: a restored credential must not be treated
    // as proof of a live Session, so the first request refreshes and lets the
    // server answer.
    recalled.mockResolvedValue(stored);

    const { credentials } = await restoreSession(beforeExpiry);

    expect(credentials?.accessToken).toBe("");
    expect(Date.parse(credentials?.accessTokenExpiresAt ?? "")).toBeLessThan(beforeExpiry());
  });

  it("does not spend a request on a refresh credential that has already lapsed", async () => {
    recalled.mockResolvedValue(stored);

    expect(await restoreSession(afterExpiry)).toEqual({ credentials: undefined });
  });

  it("treats the expiry moment itself as lapsed", async () => {
    recalled.mockResolvedValue(stored);

    const atExpiry = () => Date.parse(stored.refreshTokenExpiresAt);

    expect(await restoreSession(atExpiry)).toEqual({ credentials: undefined });
  });

  it("starts signed out when the store refused to answer", async () => {
    recalled.mockResolvedValue(undefined);

    expect(await restoreSession(beforeExpiry)).toEqual({ credentials: undefined });
  });
});
