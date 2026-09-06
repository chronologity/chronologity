import { useEffect, useState } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";
import { darkTheme, lightTheme, type Theme } from "../app/theme/theme";
import { durationFor, type Duration } from "../app/theme/motion";

/**
 * The appearance to render in, and how much movement is welcome.
 *
 * **Two inputs for motion, and either one wins.** The platform has a
 * reduced-motion switch and Chronologity has its own account preference —
 * `preferencesSchema.reducedMotion` — and no document says what to do when they
 * disagree. `accessibility.md:1105` gets closest: "Where a platform already
 * provides an authoritative preference, Chronologity should generally respect it
 * rather than forcing Users to configure the same need repeatedly."
 *
 * So: either source asking for less motion is enough. Somebody who has told the
 * operating system they get motion sick should not have to tell Chronologity
 * too, and somebody who told Chronologity should not have it overridden because
 * the phone disagrees. The failure modes are not symmetrical — animating at
 * somebody who asked you not to is the one that hurts.
 *
 * **The appearance follows the platform and nothing else.** There is no
 * in-product theme switch, because `preferencesSchema` has no field for one:
 * adding it is a contract change rather than a client decision.
 */

/** What a screen gets when it asks about presentation. */
export interface Appearance {
  /** The palette to render with. */
  readonly theme: Theme;
  /** Whether movement should be suppressed. */
  readonly reducedMotion: boolean;
  /**
   * How long a transition should take, already accounting for the above.
   *
   * @param name - The duration wanted when motion is welcome.
   * @returns Milliseconds; zero under reduced motion.
   */
  duration(name: Duration): number;
}

/**
 * Follow the platform's reduced-motion switch.
 *
 * @returns Whether the platform is currently asking for less motion. False until
 *   the first asynchronous read answers, which is the safe way round: a frame of
 *   animation that should not have happened is a smaller wrong than suppressing
 *   every animation for everybody on the strength of an unknown.
 */
function usePlatformReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let live = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (live) {
        setReduced(enabled);
      }
    });

    // The setting can change while the application is open, and a person who
    // changes it expects the change to take effect rather than to require a
    // restart.
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);

    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/**
 * Read the current appearance.
 *
 * @param accountReducedMotion - The account's own preference, when it is known.
 *   Undefined before preferences have been read, which is not the same as false.
 * @returns The theme, whether motion is reduced, and a duration resolver.
 */
export function useTheme(accountReducedMotion?: boolean): Appearance {
  const scheme = useColorScheme();
  const platformReducedMotion = usePlatformReducedMotion();

  const theme = scheme === "dark" ? darkTheme : lightTheme;
  const reducedMotion = platformReducedMotion || accountReducedMotion === true;

  return {
    theme,
    reducedMotion,
    duration: (name) => durationFor(name, reducedMotion),
  };
}
