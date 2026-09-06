import * as SecureStore from "expo-secure-store";
import { forgetSession, recallSession, rememberSession } from "./secure-storage";

jest.mock("expo-secure-store");

const mocked = SecureStore as jest.Mocked<typeof SecureStore>;

const session = {
  sessionId: "0c8f3a21-77b6-4e59-a1d4-5b9e2c7f8a03",
  refreshToken: "rt_5f8a1c9d2e6b4a70c3d5e8f1a2b4c6d8",
  refreshTokenExpiresAt: "2026-10-01T11:15:00.000Z",
};

describe("keeping a Session across launches", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("stores and reads back the same Session", async () => {
    let written = "";
    mocked.setItemAsync.mockImplementation(async (_key, value) => {
      written = value;
    });
    mocked.getItemAsync.mockImplementation(async () => written);

    await rememberSession(session);

    expect(await recallSession()).toEqual(session);
  });

  it("stores the refresh half and nothing else", async () => {
    let written = "";
    mocked.setItemAsync.mockImplementation(async (_key, value) => {
      written = value;
    });

    await rememberSession(session);

    expect(written).not.toContain("accessToken");
    expect(Object.keys(JSON.parse(written)).sort()).toEqual([
      "refreshToken",
      "refreshTokenExpiresAt",
      "sessionId",
    ]);
  });

  it("starts signed out when nothing was ever stored", async () => {
    mocked.getItemAsync.mockResolvedValue(null);

    expect(await recallSession()).toBeUndefined();
  });

  it("starts signed out when the store cannot be read", async () => {
    // A locked or unavailable keychain. Signed out is a state the application
    // already renders; a crash on launch is not.
    mocked.getItemAsync.mockRejectedValue(new Error("keychain unavailable"));

    expect(await recallSession()).toBeUndefined();
  });

  it("refuses a stored value that is not the shape that was written", async () => {
    // A write interrupted by the process being killed. Passing this through
    // would turn it into a malformed refresh request instead.
    mocked.getItemAsync.mockResolvedValue('{"sessionId":"0c8f3a21-77b6-4e59-a1d4-5b9e2c7f8a03"}');

    expect(await recallSession()).toBeUndefined();
  });

  it("refuses a stored value that is not JSON at all", async () => {
    mocked.getItemAsync.mockResolvedValue("not json");

    expect(await recallSession()).toBeUndefined();
  });

  it("does not fail a sign-in that succeeded just because storing failed", async () => {
    mocked.setItemAsync.mockRejectedValue(new Error("keychain unavailable"));

    await expect(rememberSession(session)).resolves.toBe(false);
  });

  it("reports a successful write", async () => {
    mocked.setItemAsync.mockResolvedValue(undefined);

    await expect(rememberSession(session)).resolves.toBe(true);
  });

  it("forgets on request, and survives a store that refuses", async () => {
    mocked.deleteItemAsync.mockRejectedValue(new Error("keychain unavailable"));

    await expect(forgetSession()).resolves.toBeUndefined();
    expect(mocked.deleteItemAsync).toHaveBeenCalled();
  });
});
