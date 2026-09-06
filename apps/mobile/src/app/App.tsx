import type { SessionCredentials } from "@chronologity/contracts";
import { useEffect, useMemo, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { ErrorBoundary } from "../components/feedback/error-boundary";
import { restoreSession } from "../lib/auth/session";
import { createBackend } from "../lib/api/client";
import { loadConfig } from "./config/app-config";
import { RootNavigator } from "./navigation/root.navigator";
import { Providers } from "./providers";

/**
 * The application, assembled.
 *
 * The order here is the phase's argument in miniature. Configuration is read
 * first and fails loudly if it is wrong, because an application that cannot
 * reach its backends should say so at launch rather than at the first tap. The
 * backend is built once, so every screen shares one Session and one cache. The
 * secure store is read after mount rather than before, because reading a
 * keychain is asynchronous and blocking the first frame on it is how an
 * application acquires a blank second on every cold start.
 *
 * The error boundary is outermost on purpose: it must survive whatever it
 * catches, so it cannot be inside the tree that failed.
 *
 * @returns The root element.
 */
export default function App(): React.JSX.Element {
  const config = useMemo(() => loadConfig(), []);
  const [credentials, setCredentials] = useState<SessionCredentials | undefined>(undefined);
  const [restoring, setRestoring] = useState(true);

  const backend = useMemo(
    () =>
      createBackend({
        apiUrl: config.apiUrl,
        feedUrl: config.feedUrl,
        onChange: setCredentials,
      }),
    [config.apiUrl, config.feedUrl],
  );

  useEffect(() => {
    let live = true;

    void (async () => {
      const { credentials: restored } = await restoreSession();

      // The screen may have gone by the time the keychain answers.
      if (!live) {
        return;
      }

      if (restored !== undefined) {
        // Adopting is what makes the first request refresh: the restored access
        // token is already expired, so the server decides whether this Session
        // is still real (authentication.md:1271-1279).
        backend.session.adopt(restored);
      }

      setRestoring(false);
    })();

    return () => {
      live = false;
    };
  }, [backend]);

  return (
    <ErrorBoundary>
      <Providers backend={backend} credentials={credentials} restoring={restoring}>
        <RootNavigator client={backend.client} />
        <StatusBar style="auto" />
      </Providers>
    </ErrorBoundary>
  );
}
