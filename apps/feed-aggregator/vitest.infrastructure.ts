import { createConnection } from "node:net";

/**
 * Refusing to run integration tests against infrastructure that is not there.
 *
 * The aggregator needs two stores and only two: ClickHouse, which every Timeline
 * read comes from, and PostgreSQL, which says whether a Session still
 * authenticates. It needs no broker, no mail sink and no object storage, so this
 * checks neither — a test run should not demand services the application never
 * opens.
 *
 * ClickHouse is checked here and is not in the API's copy of this file. The API
 * can serve most of itself without it; this application cannot serve anything.
 *
 * `pnpm infra:validate` already answers this question properly, by writing and
 * reading real data through every service. It is not what runs here: it takes
 * several seconds and exercises far more than a test run needs to know. The
 * question here is narrower — is anything listening — and a TCP connect answers
 * it in milliseconds.
 */

interface Service {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  /** What to do about it, since the answer is nearly always the same. */
  readonly remedy: string;
}

const CONNECT_TIMEOUT_MS = 1_000;

/**
 * Whether anything accepts a connection there.
 *
 * @param host - Where to look.
 * @param port - Which port.
 * @returns Whether a connection was accepted within a second. A refusal, a
 *   timeout and an unresolvable host are one answer here: the question is
 *   whether tests can run, not why they cannot.
 */
async function isListening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const settle = (answer: boolean) => {
      socket.destroy();
      resolve(answer);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

/**
 * Where ClickHouse is, taken apart into host and port.
 *
 * @param url - The configured HTTP endpoint.
 * @returns Its host and port, falling back to the local defaults when the value
 *   is absent or unparseable. An unparseable URL is not reported here: the
 *   configuration schema refuses it, with a better message than this could.
 */
function clickHouseAddress(url: string | undefined): { host: string; port: number } {
  try {
    const parsed = new URL(url ?? "http://localhost:8123");

    return { host: parsed.hostname, port: Number(parsed.port === "" ? "8123" : parsed.port) };
  } catch {
    return { host: "localhost", port: 8123 };
  }
}

/**
 * Fail now, naming the service, rather than later in every file at once.
 *
 * @returns Nothing.
 * @throws {Error} If either store the integration suites need is unreachable.
 *   Both are checked before reporting, so a stack that is entirely down says so
 *   once rather than one service at a time across two runs.
 */
export async function assertInfrastructureReachable(): Promise<void> {
  const clickhouse = clickHouseAddress(process.env.CLICKHOUSE_URL);

  const services: readonly Service[] = [
    {
      name: "PostgreSQL",
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      remedy: "pnpm infra:up",
    },
    {
      name: "ClickHouse",
      host: clickhouse.host,
      port: clickhouse.port,
      remedy: "pnpm infra:up",
    },
  ];

  const reachable = await Promise.all(
    services.map(async (service) => isListening(service.host, service.port)),
  );
  const missing = services.filter((_, index) => !reachable[index]);

  if (missing.length === 0) {
    return;
  }

  const listed = missing
    .map((service) => `  ${service.name} on ${service.host}:${service.port}`)
    .join("\n");

  throw new Error(
    `Integration tests need infrastructure that is not answering:\n${listed}\n\n` +
      `Run \`${missing[0]!.remedy}\` and try again. ` +
      `If Docker itself is stopped, start it first.`,
  );
}
