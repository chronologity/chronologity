import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { TimelineScreen } from "../../features/timelines/screens/timeline.screen";
import type { MainTabRoutes } from "../../types/navigation";

const Tabs = createBottomTabNavigator<MainTabRoutes>();

/**
 * Where somebody who is signed in can be.
 *
 * One tab in this phase. The Timeline is the product (`vision.md`), and a
 * bootstrap that rendered five empty tabs would be proving less than one that
 * renders real history.
 *
 * A Moment is not among them. It is pushed over the tabs by `MainNavigator`,
 * because opening one is depth rather than a change of section — and depth has
 * to be closable back to where the reader was (`timeline.md:161`).
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
