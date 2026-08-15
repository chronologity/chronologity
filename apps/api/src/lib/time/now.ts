/**
 * The current instant.
 *
 * Funnelled through one function so time can be substituted in tests, and so
 * that "when the system observed this" stays visibly distinct from the
 * occurrence times that determine historical position.
 *
 * @returns The current instant.
 */
export function now(): Date {
  return new Date();
}
