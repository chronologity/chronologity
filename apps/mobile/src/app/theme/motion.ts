/**
 * Time, as the interface spends it.
 *
 * **This file is not in the canonical tree, and it should be.** `monorepo.md`
 * names `colors`, `spacing`, `typography`, `radius` and `theme`, and no
 * duration lives in any of those. Meanwhile `reducedMotion` ships as an account
 * preference and `accessibility.md:1313` asks outright: "What maximum transition
 * duration is appropriate?" A question about a number, with nowhere to put the
 * answer.
 *
 * **200ms is the ceiling**, and it is a ceiling rather than a default: nothing in
 * this application may animate for longer. Long enough that a change reads as a
 * movement rather than a jump, short enough that somebody moving quickly is never
 * waiting for the interface to finish agreeing with them.
 *
 * **Under reduced motion every duration is zero**, which is `instant`. That is
 * the whole mechanism — there is no separate reduced-motion stylesheet, because a
 * second set of styles is a second thing to forget. `accessibility.md:375` is
 * explicit that reduced motion "must not disable temporal zoom or historical
 * jumps. It changes how those capabilities are presented", and a duration of zero
 * changes presentation without removing anything.
 */

export const duration = {
  /** No animation. What every duration becomes under reduced motion. */
  instant: 0,
  /** A control acknowledging a press. */
  fast: 120,
  /** A surface arriving or leaving. The ceiling. */
  standard: 200,
} as const;

export type Duration = keyof typeof duration;

/**
 * How long something should take, given what the reader has asked for.
 *
 * @param name - The duration wanted when motion is welcome.
 * @param reduced - Whether reduced motion is in force, from either the platform
 *   or the account.
 * @returns Milliseconds. Zero whenever motion is reduced.
 */
export function durationFor(name: Duration, reduced: boolean): number {
  return reduced ? duration.instant : duration[name];
}
