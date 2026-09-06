import { ConfigurationError } from "@chronologity/config";
import { loadConfig } from "./app-config";
import { readEnv } from "./env";

describe("reading what this build was told", () => {
  it("accepts a complete environment", () => {
    const env = readEnv({
      EXPO_PUBLIC_API_URL: "http://localhost:3000",
      EXPO_PUBLIC_FEED_URL: "http://localhost:4000",
    });

    expect(env.EXPO_PUBLIC_API_URL).toBe("http://localhost:3000");
  });

  it("refuses a missing address rather than guessing one", () => {
    expect(() => readEnv({ EXPO_PUBLIC_FEED_URL: "http://localhost:4000" })).toThrow(
      ConfigurationError,
    );
  });

  it("refuses something that is not an address", () => {
    expect(() =>
      readEnv({
        EXPO_PUBLIC_API_URL: "localhost:3000",
        EXPO_PUBLIC_FEED_URL: "http://localhost:4000",
      }),
    ).toThrow(ConfigurationError);
  });

  it("names every problem, not only the first", () => {
    let message = "";

    try {
      readEnv({});
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("EXPO_PUBLIC_API_URL");
    expect(message).toContain("EXPO_PUBLIC_FEED_URL");
  });

  it("assembles the configuration the application runs on", () => {
    const config = loadConfig({
      EXPO_PUBLIC_API_URL: "http://localhost:3000",
      EXPO_PUBLIC_FEED_URL: "http://localhost:4000",
    });

    expect(config).toEqual({
      apiUrl: "http://localhost:3000",
      feedUrl: "http://localhost:4000",
    });
  });
});
