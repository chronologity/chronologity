import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  allowsDevelopmentDefaults,
  booleanSchema,
  ConfigurationError,
  listSchema,
  parseEnv,
  portSchema,
} from "./env.js";

describe("parseEnv", () => {
  const schema = z.object({
    API_PORT: portSchema,
    API_PUBLIC_URL: z.url(),
  });

  it("returns typed configuration from string environment values", () => {
    const config = parseEnv(schema, {
      API_PORT: "3000",
      API_PUBLIC_URL: "http://localhost:3000",
    });

    assert.equal(config.API_PORT, 3000);
    assert.equal(typeof config.API_PORT, "number");
  });

  it("fails rather than defaulting when a required value is missing", () => {
    assert.throws(
      () => parseEnv(schema, { API_PUBLIC_URL: "http://localhost:3000" }),
      ConfigurationError,
    );
  });

  it("reports every problem at once", () => {
    try {
      parseEnv(schema, { API_PORT: "not-a-port", API_PUBLIC_URL: "nonsense" });
      assert.fail("expected ConfigurationError");
    } catch (error) {
      assert.ok(error instanceof ConfigurationError);
      assert.equal(error.issues.length, 2);
      assert.ok(error.issues.some((issue) => issue.startsWith("API_PORT")));
      assert.ok(error.issues.some((issue) => issue.startsWith("API_PUBLIC_URL")));
    }
  });

  it("never echoes the offending value, which may be a secret", () => {
    const secretSchema = z.object({ AUTH_JWT_SECRET: z.string().min(32) });

    try {
      parseEnv(secretSchema, { AUTH_JWT_SECRET: "too-short-but-still-secret" });
      assert.fail("expected ConfigurationError");
    } catch (error) {
      assert.ok(error instanceof ConfigurationError);
      assert.ok(!error.message.includes("too-short-but-still-secret"));
      assert.ok(error.message.includes("AUTH_JWT_SECRET"));
    }
  });

  it("rejects an empty string rather than treating it as unset", () => {
    assert.throws(
      () => parseEnv(schema, { API_PORT: "3000", API_PUBLIC_URL: "" }),
      ConfigurationError,
    );
  });
});

describe("environment value schemas", () => {
  it("rejects ports outside the valid range", () => {
    assert.equal(portSchema.parse("8123"), 8123);
    assert.equal(portSchema.safeParse("0").success, false);
    assert.equal(portSchema.safeParse("70000").success, false);
  });

  it("reads booleans from the string forms environments provide", () => {
    assert.equal(booleanSchema.parse("true"), true);
    assert.equal(booleanSchema.parse("1"), true);
    assert.equal(booleanSchema.parse("false"), false);
    assert.equal(booleanSchema.parse("0"), false);
    assert.equal(booleanSchema.safeParse("yes").success, false);
  });

  it("trims list entries and drops empty ones", () => {
    assert.deepEqual(listSchema.parse("a, b ,,c"), ["a", "b", "c"]);
    assert.deepEqual(listSchema.parse(""), []);
  });
});

describe("allowsDevelopmentDefaults", () => {
  it("withholds convenience defaults from production", () => {
    assert.equal(allowsDevelopmentDefaults("development"), true);
    assert.equal(allowsDevelopmentDefaults("test"), true);
    assert.equal(allowsDevelopmentDefaults("production"), false);
  });
});
