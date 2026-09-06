import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MomentScreen } from "../../features/moments/screens/moment.screen";
import type { MainRoutes } from "../../types/navigation";
import { MainTabsNavigator } from "./main-tabs.navigator";

const Stack = createNativeStackNavigator<MainRoutes>();

/**
 * Where somebody signed in can be.
 *
 * **A stack with the tabs at its root**, so a Moment is pushed over them rather
 * than being a hidden tab. That was the defect this fixes: `moment` was declared
 * in `types/navigation.ts` and routed to in `linking.ts` and registered in no
 * navigator at all, so `chronologity://moment/<id>` resolved to nothing and
 * failed silently — the worst way for a link to fail.
 *
 * A push rather than a tab is also the right shape for what opening a Moment
 * *is*. It is depth, the third of the Timeline's three dimensions, and
 * `timeline.md:161` requires that "Exiting should return the user to the same
 * meaningful chronological and contextual position". A stack does that by
 * construction; swapping a tab does not.
 *
 * @returns The navigator.
 */
export function MainNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen component={MainTabsNavigator} name="tabs" options={{ headerShown: false }} />
      <Stack.Screen component={MomentScreen} name="moment" options={{ title: "Moment" }} />
    </Stack.Navigator>
  );
}
