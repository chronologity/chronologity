import { Component, type ErrorInfo, type ReactNode } from "react";
import { View } from "react-native";
import { spacing } from "../../app/theme/spacing";
import { AppButton } from "../primitives/app-button";
import { AppText } from "../primitives/app-text";

/**
 * The last thing between a render failure and a blank screen.
 *
 * A React render error unmounts the whole tree, and on a phone that is not an
 * error message — it is an application that vanished. This catches it and
 * offers the one action that helps.
 *
 * **What it shows, and what it must not.** `observability.md:1556-1562`
 * requires crash reports to scrub tokens, private media paths, and sensitive
 * input; the same reasoning applies more strongly to something rendered on
 * screen, which can be photographed and shared. So the message a person sees is
 * fixed text. The error itself goes to `onError`, which is where a reporter will
 * be attached when one is chosen — `observability.md:1891-1896` leaves the
 * provider open, and this phase does not close it.
 *
 * A class component because that is the only form React offers for this;
 * `componentDidCatch` has no hook equivalent.
 */

/** What the boundary wraps, and who to tell. */
export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * Told what was caught.
   *
   * The seam for a crash reporter. Left unattached in this phase deliberately:
   * a reporter is a decision about what leaves the device, and that decision has
   * not been made.
   */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Catches a render failure below it and offers a way back.
 *
 * A class because `componentDidCatch` has no hook equivalent; React offers no
 * other way to do this.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  /**
   * Move into the failed state when a child throws.
   *
   * @returns The next state.
   */
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  /**
   * Report what was caught.
   *
   * @param error - What was thrown.
   * @param info - Which part of the tree it came from.
   * @returns Nothing.
   */
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  /**
   * Let the person try again.
   *
   * Re-rendering the same tree is worth offering because plenty of render
   * failures are transient — a value that had not arrived yet. If it fails
   * again, this catches it again.
   *
   * @returns Nothing.
   */
  private readonly retry = (): void => {
    this.setState({ failed: false });
  };

  /**
   * Render the children, or the fallback.
   *
   * @returns The element.
   */
  override render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <View
        style={{
          alignItems: "center",
          flex: 1,
          gap: spacing.md,
          justifyContent: "center",
          padding: spacing.xxl,
        }}
        testID="error-boundary-fallback"
      >
        <AppText variant="title">Something went wrong</AppText>
        <AppText color="textSecondary" style={{ textAlign: "center" }}>
          Chronologity could not show this. Your history is safe — nothing was changed.
        </AppText>
        <AppButton label="Try again" onPress={this.retry} tone="secondary" />
      </View>
    );
  }
}
