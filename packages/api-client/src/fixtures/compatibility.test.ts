import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { ApiError } from "../api-error.js";
import { createApiClient, type ApiClient } from "../client.js";
import { getCapabilities } from "../operations/authorization.js";
import { getMoment, listMoments } from "../operations/moments.js";
import { listNotifications } from "../operations/notifications.js";
import { search } from "../operations/search.js";
import { registerUpload } from "../operations/uploads.js";
import { getCurrentUser } from "../operations/users.js";
import { createSessionFromPassword } from "../operations/authentication.js";

/**
 * Responses recorded once still parse.
 *
 * **The gap this fills.** The API's integration tests assert response bodies
 * against literals written in the same commit as the schema, so a schema and its
 * assertions move together and nothing notices. `testing.md:1486` asks for the
 * opposite: shapes recorded at one moment, checked against the contract as it is
 * now, so a boundary that narrowed says so.
 *
 * The rule being tested is `deployment.md:766`'s — **prefer compatible
 * additions**. A field appearing in a response an older client did not expect is
 * fine, and stays fine. A field removed, renamed, or narrowed is not: an app
 * already on somebody's phone would stop reading a response the server considers
 * perfectly good, and nothing between here and the store would catch it.
 *
 * **The fixtures are frozen on purpose.** They are hand-recorded JSON rather
 * than values built from the schemas, because a fixture generated from the thing
 * it checks agrees with it by construction and proves nothing. When one of these
 * stops parsing, either the change is deliberate — in which case the fixture is
 * re-recorded and the version it belonged to is retired — or it is the
 * incompatibility this exists to find.
 *
 * They are parsed **through the operations**, not against the schemas directly,
 * so what is checked is the schema an operation actually attached rather than
 * the one it was supposed to.
 */

/**
 * Read one recorded response.
 *
 * @param name - The fixture's file name, without its extension.
 * @returns The recorded body, exactly as it was recorded.
 */
function recorded(name: string): unknown {
  const path = fileURLToPath(new URL(`./responses/${name}.json`, import.meta.url));

  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * A client that answers every request with one body.
 *
 * @param body - What to answer with.
 * @param status - The status to answer with.
 * @returns The client.
 */
function answering(body: unknown, status = 200): ApiClient {
  return createApiClient({
    baseUrl: "http://api.test/",
    fetch: async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  });
}

describe("keeping responses recorded earlier parsable", () => {
  it("reads a Moment", async () => {
    const body = recorded("moment");

    const moment = await getMoment(answering(body), {
      params: { momentId: "7ea1c1f4-1b1e-4c7b-9d5e-2a4f9c8b1d30" },
    });

    assert.equal(moment.momentId, "7ea1c1f4-1b1e-4c7b-9d5e-2a4f9c8b1d30");
    assert.equal(moment.media[0]?.kind, "image");
    assert.equal(moment.occurrence.precision, "instant");
  });

  it("reads a page of Moments, cursor and all", async () => {
    const page = await listMoments(answering(recorded("moment-page")), { query: {} });

    assert.deepEqual(page.moments, []);
    assert.equal(typeof page.nextCursor, "string");
  });

  it("reads the signed-in account", async () => {
    const user = await getCurrentUser(answering(recorded("current-user")), {});

    assert.equal(user.handle, "rowan");
    assert.equal(user.preferences.timelineIsPublic, true);
  });

  it("reads credentials from a sign-in", async () => {
    const credentials = await createSessionFromPassword(
      answering(recorded("session-credentials")),
      { body: { email: "rowan@example.test", password: "a-sufficiently-long-password" } },
    );

    assert.equal(typeof credentials.accessTokenExpiresAt, "string");
    assert.equal(typeof credentials.refreshToken, "string");
  });

  it("reads a page of notifications", async () => {
    const page = await listNotifications(answering(recorded("notification-page")), { query: {} });

    assert.equal(page.notifications[0]?.type, "participation_proposed");
    assert.equal(page.notifications[0]?.readAt, null);
  });

  it("reads a page of search results", async () => {
    const page = await search(answering(recorded("search-page")), {
      query: { q: "old house" },
    });

    assert.equal(page.total, 1);
    assert.deepEqual(page.results[0]?.matchedOn, ["caption_match"]);
  });

  it("reads an upload authorization", async () => {
    const authorization = await registerUpload(answering(recorded("upload-authorization")), {
      body: { contentType: "image/jpeg", declaredByteSize: 2841923 },
    });

    assert.equal(authorization.contentType, "image/jpeg");
    assert.notEqual(authorization.uploadUrlExpiresAt, authorization.expiresAt);
  });

  it("reads what this account may do", async () => {
    const capabilities = await getCapabilities(answering(recorded("capabilities")), {});

    assert.deepEqual(capabilities.roles, []);
  });

  it("reads a refusal", async () => {
    const client = answering(recorded("error-response"), 429);

    await assert.rejects(getCapabilities(client, {}), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "RATE_LIMITED");
      assert.equal(error.traceId, "0af7651916cd43dd8448eb211c80319c");

      return true;
    });
  });

  it("tolerates a field the recording did not have", async () => {
    // The compatible half of the rule. A server that starts sending something
    // new must not break a client that was written before it existed.
    const body = { ...(recorded("moment") as Record<string, unknown>), mood: "wistful" };

    const moment = await getMoment(answering(body), {
      params: { momentId: "7ea1c1f4-1b1e-4c7b-9d5e-2a4f9c8b1d30" },
    });

    assert.equal("mood" in moment, false);
  });

  it("refuses a response missing something the contract requires", async () => {
    // The half that bites. Without this the test above would pass for a schema
    // that had quietly stopped requiring anything at all.
    const { caption, ...withoutCaption } = recorded("moment") as Record<string, unknown>;

    assert.equal(typeof caption, "string");

    await assert.rejects(
      getMoment(answering(withoutCaption), {
        params: { momentId: "7ea1c1f4-1b1e-4c7b-9d5e-2a4f9c8b1d30" },
      }),
    );
  });
});
