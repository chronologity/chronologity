import type { ApiClient } from "@chronologity/api-client";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SignInScreen } from "../../features/auth/screens/sign-in.screen";
import type { AuthRoutes } from "../../types/navigation";

const Stack = createNativeStackNavigator<AuthRoutes>();

/** What the unauthenticated half needs. */
export interface AuthNavigatorProps {
  readonly client: ApiClient;
}

/**
 * Where somebody who is not signed in can be.
 *
 * One screen for now. It is a navigator rather than a bare screen because
 * registration, magic links and password recovery join it in Phase 12, and the
 * shape the canonical tree names (`monorepo.md:317-323`) is the one they arrive
 * into.
 *
 * @param props - The client to sign in through.
 * @returns The navigator.
 */
export function AuthNavigator({ client }: AuthNavigatorProps): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in">{() => <SignInScreen client={client} />}</Stack.Screen>
    </Stack.Navigator>
  );
}
