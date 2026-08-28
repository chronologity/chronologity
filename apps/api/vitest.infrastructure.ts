import { createConnection } from "node:net";

/**
 * Refusing to run integration tests against infrastructure that is not there.
 *
 * These suites need PostgreSQL, Kafka, object storage and a mail sink. When one
 * is missing the failure is not a missing service — it is thirty-seven test
 * files failing at once with connection errors buried in their output, which
 * reads as "the branch is broken" and costs a full run to disbelieve. That
 * happened three times in one day while Docker Desktop kept stopping.
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
 * Fail now, naming the service, rather than later in thirty-seven files.
 *
 * @returns Nothing.
 * @throws {Error} If any service the integration suites need is unreachable.
 *   Every one is checked before reporting, so a stack that is entirely down
 *   says so once rather than one service at a time across four runs.
 */
export async function assertInfrastructureReachable(): Promise<void> {
  const services: readonly Service[] = [
    {
      name: "PostgreSQL",
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? "5432"),
      remedy: "pnpm infra:up",
    },
    {
      name: "Kafka",
      host: "localhost",
      port: Number((process.env.KAFKA_BROKERS ?? "localhost:9092").split(":").pop()),
      remedy: "pnpm infra:up",
    },
    {
      name: "Object storage",
      host: "127.0.0.1",
      port: Number(process.env.S3_PORT ?? "8333"),
      remedy: "pnpm infra:up",
    },
    {
      name: "Mailpit",
      host: process.env.SMTP_HOST ?? "localhost",
      port: Number(process.env.SMTP_PORT ?? "1025"),
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
