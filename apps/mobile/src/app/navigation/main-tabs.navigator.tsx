import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { TimelineScreen } from "../../features/timelines/screens/timeline.screen";
import type { MainRoutes } from "../../types/navigation";

const Tabs = createBottomTabNavigator<MainRoutes>();

/**
 * Where somebody who is signed in can be.
 *
 * One tab in this phase. The Timeline is the product (`vision.md`), and a
 * bootstrap that rendered five empty tabs would be proving less than one that
 * renders real history.
 *
 * The `moment` route is declared and hidden from the bar, because a deep link
 * names it and `linking.ts` has to have somewhere to send one. What it renders
 * is Phase 12's; what matters here is that the destination exists and is
 * reauthorized on arrival like everything else.
 *
 * @returns The navigator.
 */
export function MainTabsNavigator(): React.JSX.Element {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="timeline" component={TimelineScreen} options={{ title: "Timeline" }} />
    </Tabs.Navigator>
  );
}
