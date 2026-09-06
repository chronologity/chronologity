import { AppButton } from "../primitives/app-button";

/**
 * Trying again.
 *
 * `accessibility.md:798` lists "retry is required" among the states a person
 * must be told about, and `ErrorState` was telling them something had gone wrong
 * while offering nothing to do about it. On a phone, with no address bar and no
 * reload, that leaves force-quitting the application as the only way forward.
 *
 * A named component rather than an `AppButton` at each call site, because the
 * word should be the same everywhere: `accessibility.md:972` asks that "The same
 * conceptual action should use consistent names and semantics across the
 * product."
 */

export interface RetryButtonProps {
  readonly onPress: () => void;
  /** Whether the retry is already in flight. */
  readonly busy?: boolean;
  readonly testID?: string;
}

/**
 * Render a retry control.
 *
 * @param props - What retrying does, and whether it is already happening.
 * @returns The element.
 */
export function RetryButton({
  onPress,
  busy = false,
  testID,
}: RetryButtonProps): React.JSX.Element {
  return (
    <AppButton
      busy={busy}
      label="Try again"
      onPress={onPress}
      testID={testID ?? "retry"}
      tone="secondary"
    />
  );
}
