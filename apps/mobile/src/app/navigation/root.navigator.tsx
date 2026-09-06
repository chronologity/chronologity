import type { ApiClient } from "@chronologity/api-client";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { AppLoader } from "../../components/primitives/app-loader";
import { Screen } from "../../components/layout/screen";
import { useTheme } from "../../hooks/use-theme";
import { useSession } from "../providers";
import { AuthNavigator } from "./auth.navigator";
import { linking } from "./linking";
import { MainNavigator } from "./main.navigator";

/** What the root needs to hand down. */
export interface RootNavigatorProps {
  readonly client: ApiClient;
}

/**
 * Which half of the application is showing.
 *
 * **Three states, not two.** Signed in and signed out are the obvious pair; the
 * third is not knowing yet, while the secure store is being read. Collapsing it
 * into "signed out" would show the sign-in screen to somebody who is already
 * signed in, for as long as the keychain takes — which is the flicker that makes
 * an application feel like it has forgotten who you are.
 *
 * **Swapped rather than navigated between.** Signing out replaces the tree, so
 * there is no back stack leading from the sign-in screen into somebody's
 * history. What a client shows is never authorization (`authorization.md:709`)
 * — the server refuses regardless — but leaving a screen mounted that the
 * current Viewer has no business seeing is how a stale render becomes a leak.
 *
 * @param props - The client the screens need.
 * @returns The element.
 */
export function RootNavigator({ client }: RootNavigatorProps): React.JSX.Element {
  const { credentials, restoring } = useSession();
  const { theme } = useTheme();

  // React Navigation paints the screen background, headers and tab bar from its
  // own theme. Left unfed it uses its defaults, which is a second uncontrolled
  // source of colour sitting underneath a carefully measured one — and it shows
  // as a white flash behind a dark screen.
  const base = theme.dark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    dark: theme.dark,
    colors: {
      ...base.colors,
      background: theme.colors.background,
      border: theme.colors.border,
      card: theme.colors.surface,
      notification: theme.colors.danger,
      primary: theme.colors.accent,
      text: theme.colors.textPrimary,
    },
  };

  if (restoring) {
    return (
      <Screen centred testID="restoring">
        <AppLoader label="Restoring your session" showLabel={false} />
      </Screen>
    );
  }

  return (
    <NavigationContainer linking={linking} theme={navigationTheme}>
      {credentials === undefined ? <AuthNavigator client={client} /> : <MainNavigator />}
    </NavigationContainer>
  );
}
