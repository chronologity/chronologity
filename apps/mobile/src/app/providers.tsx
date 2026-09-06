import type { SessionCredentials } from "@chronologity/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  SafeAreaProvider,
  initialWindowMetrics,
  type Metrics,
} from "react-native-safe-area-context";
import type { Backend } from "../lib/api/client";

/**
 * Everything the tree below needs, supplied once.
 *
 * **One query cache for two protocols.** Chronologity's client speaks REST to
 * the authoritative API and GraphQL to the read-only aggregator, and both go
 * through TanStack Query rather than each bringing its own cache. The
 * aggregator has no mutations and no subscriptions (ADR-136), so the normalized
 * cache a GraphQL client exists to provide would be solving a problem this
 * surface does not have — while costing a second invalidation model to reason
 * about every time something looks stale.
 *
 * **What the cache is, and is not.** `caching.md:258-272` permits a mobile
 * client to hold Timeline pages, Moment detail, profiles and notifications, and
 * then says the thing that governs all of it: client caches are UX state, and
 * the server remains authoritative. Nothing cached here is ever consulted to
 * decide what somebody may see. When privacy changes, `caching.md:972-978`
 * requires content that has become restricted to disappear on revalidation —
 * which is why nothing is given an infinite lifetime.
 *
 * Offline is deliberately absent. ADR-154 defers it until the product and
 * security decisions `caching.md:982` requires have been made, so this cache
 * lives in memory and does not outlive the process.
 */

/** What a screen can ask for. */
export interface BackendContextValue extends Backend {
  /** What the Session holds now. Undefined means signed out. */
  readonly credentials: SessionCredentials | undefined;
  /** Whether the cold-start recovery is still running. */
  readonly restoring: boolean;
}

const BackendContext = createContext<BackendContextValue | undefined>(undefined);

/**
 * Read the backend from context.
 *
 * @returns Both readers, the Session, and what it currently holds.
 * @throws {Error} If called outside the providers, which is a wiring mistake
 *   rather than a state a person can reach.
 */
export function useBackend(): BackendContextValue {
  const value = useContext(BackendContext);

  if (value === undefined) {
    throw new Error("useBackend was called outside <Providers>");
  }

  return value;
}

/**
 * Read just the signed-in state.
 *
 * @returns The Session, what it holds, and whether restoration is still running.
 */
export function useSession(): Pick<BackendContextValue, "session" | "credentials" | "restoring"> {
  return useBackend();
}

/** What the providers wrap, and what they wrap it around. */
export interface ProvidersProps {
  readonly backend: Backend;
  /**
   * What the Session holds now.
   *
   * Passed in rather than subscribed to here. `createSession` takes its change
   * listener when it is built, so whoever built the backend already owns this
   * state — and a second subscription would be a second copy to disagree with
   * the first.
   */
  readonly credentials: SessionCredentials | undefined;
  /** Whether the cold-start recovery is still running. */
  readonly restoring: boolean;
  /**
   * The window insets to start from.
   *
   * Defaults to what the platform already knows at launch. Supplying them means
   * the first frame is laid out correctly instead of being measured and then
   * corrected, which is a visible jump on a device with a notch. It also matters
   * off-device: with no metrics the provider renders nothing at all, so a test
   * that does not supply them sees an empty tree.
   */
  readonly initialMetrics?: Metrics | null;
  readonly children: ReactNode;
}

/**
 * Supply the query cache, safe-area insets, and the Session.
 *
 * @param props - The backend to expose, what its Session currently holds,
 *   whether restoration is still in progress, the window insets to start from,
 *   and the tree to render.
 * @returns The wrapped tree.
 */
export function Providers({
  backend,
  credentials,
  restoring,
  initialMetrics = initialWindowMetrics,
  children,
}: ProvidersProps): React.JSX.Element {
  // Built once. A new QueryClient on every render would discard the cache on
  // every render, which is the same as having none.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Long enough that moving between screens does not refetch;
            // short enough that a Moment made private stops being shown
            // without the app being restarted (caching.md:972-978).
            staleTime: 30_000,
            // A refusal is an answer. Retrying a 403 produces another 403, and
            // `packages/api-client` already retries what is worth retrying —
            // by error code and method, which is more than this layer knows
            // (ADR-153).
            retry: false,
          },
        },
      }),
  );

  const value = useMemo(
    () => ({ ...backend, credentials, restoring }),
    [backend, credentials, restoring],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
