import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createPushClient } from "./push-client.js";

/** Everything the adapter wrote, as one searchable string per line. */
const recorder = () => {
  const lines: string[] = [];
  const write = (payload: unknown, message?: string) => {
    lines.push(`${message ?? ""} ${JSON.stringify(payload)}`);
  };

  return {
    lines,
    logger: { info: write, warn: write, error: write, debug: write } as never,
  };
};

const TARGET = {
  deviceId: "device-1",
  platform: "ios",
  token: "a-provider-credential-nobody-should-read",
};

describe("createPushClient", () => {
  it("records what it was asked to send", async () => {
    const { lines, logger } = recorder();

    await createPushClient(logger).send(TARGET, { title: "A new follower", body: "Someone" });

    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /no provider is configured/);
  });

  it("never writes the token", async () => {
    // A push token is a credential: anybody holding it can send to that device.
    // Asserted here rather than only through the dispatcher, because the
    // dispatcher's tests hand it a double and would never reach this code.
    const { lines, logger } = recorder();

    await createPushClient(logger).send(TARGET, { title: "A new follower", body: "Someone" });

    assert.doesNotMatch(lines.join("\n"), /a-provider-credential-nobody-should-read/);
  });

  it("never writes the body", async () => {
    // A push body is the one piece of notification text written for a surface
    // other people can see. Copying it into a log spreads it further than the
    // lock screen ever would.
    const { lines, logger } = recorder();

    await createPushClient(logger).send(TARGET, {
      title: "A new comment on your Moment",
      body: "3 people commented on your Moment.",
    });

    assert.doesNotMatch(lines.join("\n"), /3 people commented/);
  });

  it("sends without a logger at all", async () => {
    await createPushClient().send(TARGET, { title: "A new follower", body: "Someone" });
  });
});
