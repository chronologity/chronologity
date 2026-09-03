import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import type { Viewer } from "../../auth/auth-context.js";
import type { GraphQLContext } from "../context/graphql-context.js";
import { queryResolvers } from "./query.resolver.js";

/**
 * The root resolvers, as pure mapping.
 *
 * They are meant to be thin, and a test that has to build a store to exercise
 * one would be evidence that they are not.
 */

const contextFor = (viewer: Viewer): GraphQLContext =>
  ({ viewer, traceId: "a-trace" }) as unknown as GraphQLContext;

describe("Query.viewer", () => {
  it("reports an anonymous reader as unauthenticated, with no account", () => {
    const context = contextFor({ kind: "anonymous" });

    const result = queryResolvers.Query.viewer(undefined, undefined, context);

    assert.deepEqual(result, { authenticated: false, userId: null });
  });

  it("reports an authenticated reader and the account reading", () => {
    const userId = randomUUID();
    const context = contextFor({
      kind: "authenticated",
      identityId: randomUUID(),
      sessionId: randomUUID(),
      userId,
    });

    const result = queryResolvers.Query.viewer(undefined, undefined, context);

    assert.deepEqual(result, { authenticated: true, userId });
  });

  it("reports somebody mid-onboarding as authenticated with no account yet", () => {
    // The difference a client acts on: "sign in" against "finish signing up".
    const context = contextFor({
      kind: "authenticated",
      identityId: randomUUID(),
      sessionId: randomUUID(),
      userId: undefined,
    });

    const result = queryResolvers.Query.viewer(undefined, undefined, context);

    assert.deepEqual(result, { authenticated: true, userId: null });
  });

  it("never reports the Identity or the Session", () => {
    // Neither is the client's business, and both name something the API owns.
    const context = contextFor({
      kind: "authenticated",
      identityId: randomUUID(),
      sessionId: randomUUID(),
      userId: randomUUID(),
    });

    const result = queryResolvers.Query.viewer(undefined, undefined, context);

    assert.deepEqual(Object.keys(result).sort(), ["authenticated", "userId"]);
  });
});
