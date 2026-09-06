import type { ApiClient } from "@chronologity/api-client";
import { NavigationContainer } from "@react-navigation/native";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSession } from "../providers";
import { AuthNavigator } from "./auth.navigator";
import { linking } from "./linking";
import { MainTabsNavigator } from "./main-tabs.navigator";

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

  if (restoring) {
    return (
      <View style={styles.container} testID="restoring">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer linking={linking}>
      {credentials === undefined ? <AuthNavigator client={client} /> : <MainTabsNavigator />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", flex: 1, justifyContent: "center" },
});
