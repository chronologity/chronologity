#!/usr/bin/env node
//
// Measure how the API behaves under sustained load, repeatably.
//
// The number a laptop produces is worth very little on its own — it measures
// this machine, with these containers, on this afternoon. It is worth a great
// deal as a comparison: the second run is the one that tells you something,
// which is why the first is recorded now rather than when somebody suspects a
// regression and has nothing to compare against.
//
// Nothing here runs in CI. A shared runner's throughput varies by more than any
// regression worth catching, so a threshold built on it would fail for reasons
// nobody can act on and would be deleted within a fortnight.
//
// Usage: pnpm load            measure and print
//        pnpm load --save     measure and write the baseline

import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASELINE = `${ROOT}docs/architecture/load-baseline.json`;

// Loaded here rather than left to the shell, exactly as the integration config
// does it. The API validates its configuration at startup and refuses to run
// without it, which is the right behaviour and reads as "the API never
// answered" from out here unless the file is read first.
const envFile = `${ROOT}.env`;

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const HOST = process.env.LOAD_HOST ?? "127.0.0.1";
const PORT = Number(process.env.LOAD_PORT ?? "3100");
const BASE = `http://${HOST}:${PORT}`;
const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? "8025"}`;

// The same guard `reset-database.sh` carries, for the same reason: this sends
// hundreds of requests a second at whatever it is pointed at, and the only
// thing it may ever be pointed at is this machine.
if (!["127.0.0.1", "localhost", "::1"].includes(HOST)) {
  console.error(`Refusing to load-test '${HOST}'. This measures local development only.`);
  process.exit(1);
}

/** Wait until the API answers, or give up. */
async function waitForApi(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health/live`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`The API never answered on ${BASE}`);
}

/** Read the most recent sign-in link Mailpit received for an address. */
async function readLinkFor(email, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const body = await search.json();
    const id = body.messages?.[0]?.ID;

    if (id !== undefined) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${id}`);
      const detail = await message.json();
      const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(detail.Text ?? "")?.[1];

      if (token !== undefined) return token;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`No sign-in link arrived for ${email}`);
}

const post = (path, body, token) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });

/** Somebody with an account, so the authenticated paths have a real Viewer. */
async function onboard() {
  const email = `load-${crypto.randomUUID()}@example.test`;

  await post("/auth/magic-link", { email });

  const session = await (await post("/auth/sessions", { token: await readLinkFor(email) })).json();
  const handle = `l${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;

  const created = await post(
    "/users",
    { handle, displayName: "Load", dateOfBirth: "1990-04-12" },
    session.accessToken,
  );

  if (created.status !== 201) {
    throw new Error(`Could not create an account: ${created.status} ${await created.text()}`);
  }

  return { accessToken: session.accessToken, userId: (await created.json()).userId };
}

/**
 * One scenario, measured twice.
 *
 * The first run is discarded on purpose. It pays for a cold process, an empty
 * connection pool and an unwarmed query plan, none of which a running service
 * pays repeatedly — so including it would record the cost of starting up and
 * call it the cost of serving.
 */
async function measure(name, path, options = {}) {
  // The whole URL, not a `path` option. autocannon has no such option at the
  // top level and ignores one silently, so every request went to `/` and
  // answered 404 — which looked like a working harness producing 2,618
  // requests a second until the check below asked what it had served.
  const url = `${BASE}${path}`;

  await autocannon({ url, connections: 10, duration: 5, ...options });

  const result = await autocannon({ url, connections: 10, duration: 10, ...options });

  // A scenario that answered with errors measured the cost of refusing, and
  // recording that as throughput would be worse than recording nothing: it
  // looks like a baseline and compares against one. This is how the rate
  // limiter went unnoticed the first time.
  if (result.non2xx > 0 || result.errors > 0) {
    throw new Error(
      `${name} did not serve cleanly: ${result.non2xx} non-2xx and ${result.errors} errors ` +
        `of ${result.requests.total} requests. The numbers would measure failure, not service.`,
    );
  }

  return {
    name,
    requestsPerSecond: Math.round(result.requests.average),
    latencyMs: { p50: result.latency.p50, p97_5: result.latency.p97_5, max: result.latency.max },
    requests: result.requests.total,
  };
}

const api = spawn("node", ["dist/main.js"], {
  cwd: `${ROOT}apps/api`,
  env: {
    ...process.env,
    API_PORT: String(PORT),
    API_HOST: HOST,
    LOG_LEVEL: "fatal",
    // Raised far above the production ceiling, which is three hundred a
    // minute. Left alone, the limiter answers 429 within a fraction of a
    // second and every number below becomes the cost of refusing a request
    // rather than of serving one — the first run of this harness recorded
    // 2,618 requests a second and every one of them was rejected.
    API_RATE_LIMIT_PER_MINUTE: "10000000",
  },
  stdio: ["ignore", "ignore", "inherit"],
});

try {
  await waitForApi();

  const { accessToken } = await onboard();
  const authorization = `Bearer ${accessToken}`;

  const scenarios = [
    // The floor: routing and serialisation with no work behind it. What this
    // separates is "the API got slower" from "the laptop got busier".
    await measure("liveness", "/health/live"),
    // An authenticated read: a token verified, a session checked, one row.
    await measure("read own profile", "/users/me", { headers: { authorization } }),
    // An authenticated list, which is the shape most reads take.
    await measure("list moments", "/moments?limit=20", { headers: { authorization } }),
  ];

  const report = {
    recordedAt: new Date().toISOString(),
    commit: process.env.GIT_COMMIT ?? "unrecorded",
    machine: {
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
      memoryGb: Math.round(totalmem() / 1024 ** 3),
      node: process.version,
    },
    // Stated so a later reader knows what the numbers are worth.
    caveat:
      "Measured on one developer machine against local containers. Comparable to another run on the same machine; not to anything else.",
    // Recorded because the first baseline looked alarming without it: an
    // authenticated read came out around fifty times slower than liveness, and
    // the obvious reading was that authentication is expensive. It is not. A
    // bare `SELECT 1` to the containerised PostgreSQL measured 2.9ms at the
    // median from this host — Docker Desktop's network on macOS, where a local
    // socket would be under a tenth of a millisecond. An authenticated request
    // makes three lookups, so roughly nine milliseconds is gone before the API
    // does anything, and the rest is contention on four cores already running
    // PostgreSQL, Kafka, ClickHouse and object storage.
    //
    // So the authenticated numbers here measure this laptop's Docker networking
    // more than they measure Chronologity. They are still worth recording, as
    // long as nobody reads them as a verdict on the code.
    databaseRoundTripMs: { select1p50: 2.9, measuredFrom: "host to container" },
    scenarios,
  };

  console.log(JSON.stringify(report, null, 2));

  if (process.argv.includes("--save")) {
    writeFileSync(BASELINE, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`\nBaseline written to ${BASELINE}`);
  }
} finally {
  api.kill("SIGTERM");
}
