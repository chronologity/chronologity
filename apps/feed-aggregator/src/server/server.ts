import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/app-config.js";

export interface Closable {
  readonly name: string;
  close(): Promise<void>;
}

export interface StartServerOptions {
  readonly app: FastifyInstance;
  readonly config: AppConfig;
  /** Closed in reverse order during shutdown, after the server stops accepting requests. */
  readonly resources: readonly Closable[];
}

/** Signals that should end the process cleanly rather than abruptly. */
const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

/** How long to wait for in-flight work before giving up and exiting anyway. */
const SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * Bind the server and install shutdown handling.
 *
 * Shutdown order is deliberate: stop accepting connections, let in-flight
 * requests finish, then close the stores. Closing a connection pool while
 * requests still hold it turns a clean deploy into a burst of errors.
 *
 * @param options - The application, its configuration, and the resources to
 *   close during shutdown.
 * @returns Nothing, once the server is listening.
 */
export async function startServer({ app, config, resources }: StartServerOptions): Promise<void> {
  let shuttingDown = false;

  const shutdown = async (reason: string): Promise<void> => {
    // A second signal during shutdown must not start a second shutdown.
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    // Captured before close(): Fastify tears its logger down as part of
    // closing, which would otherwise silently swallow every message below —
    // including the resource failures most worth seeing during a deploy.
    const log = app.log;

    log.info({ reason }, "Shutting down");

    const timeout = setTimeout(() => {
      app.log.error({ reason }, "Shutdown timed out, exiting");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    // Do not keep the event loop alive purely to wait for this timer.
    timeout.unref();

    try {
      await app.close();

      for (const resource of [...resources].reverse()) {
        try {
          await resource.close();
        } catch (error) {
          // One resource failing to close must not strand the others.
          log.error({ err: error, resource: resource.name }, "Failed to close resource");
        }
      }

      log.info("Shutdown complete");
    } catch (error) {
      log.error({ err: error }, "Shutdown failed");
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }

  process.on("unhandledRejection", (error) => {
    app.log.error({ err: error }, "Unhandled rejection");
    void shutdown("unhandledRejection");
    process.exitCode = 1;
  });

  await app.listen({ host: config.host, port: config.port });
}
