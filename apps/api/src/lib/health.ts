/**
 * The contract every infrastructure dependency implements.
 *
 * Readiness is only meaningful if it asks each dependency a question that can
 * actually fail. A dependency that reports healthy because its client object
 * exists tells the orchestrator nothing.
 */
export interface HealthCheckable {
  readonly name: string;
  /** Perform a real round trip. Implementations must not cache the result. */
  checkHealth(): Promise<void>;
}

export interface DependencyHealth {
  readonly name: string;
  readonly healthy: boolean;
  readonly error?: string;
}

/**
 * Check every dependency concurrently.
 *
 * Failures are reported rather than thrown: readiness needs to say which
 * dependency is unavailable, not merely that something is.
 *
 * @param dependencies - Everything this instance needs to serve traffic.
 * @returns Each dependency's name and whether it answered, checked concurrently.
 *   Failures are reported rather than thrown: readiness needs to say which
 *   dependency is unavailable, not merely that something is.
 */
export async function checkDependencies(
  dependencies: readonly HealthCheckable[],
): Promise<DependencyHealth[]> {
  return Promise.all(
    dependencies.map(async ({ name, checkHealth }) => {
      try {
        await checkHealth();
        return { name, healthy: true };
      } catch (error) {
        return {
          name,
          healthy: false,
          error: error instanceof Error ? error.message : "unknown error",
        };
      }
    }),
  );
}
