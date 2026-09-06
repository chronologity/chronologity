import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import { EmptyState } from "../../../components/feedback/empty-state";
import { Screen } from "../../../components/layout/screen";
import type { MainRoutes } from "../../../types/navigation";

/**
 * One Moment, opened directly.
 *
 * **This exists because a deep link needed somewhere to land.** `linking.ts`
 * routes `chronologity://moment/<id>` here and `types/navigation.ts` declares
 * the route, and until now nothing mounted it — so the link resolved to nothing
 * and failed silently, which is the worst way for a link to fail.
 *
 * What it shows is deliberately thin: reading a Moment in full — its media, its
 * Comments, its Reactions, its context — is 12E. What it establishes is that the
 * destination exists.
 *
 * **Arriving here confers nothing.** `privacy.md:432-442` states it as an
 * equation: knowledge of an identifier is not authorization. Whether this Moment
 * exists, and whether the reader may see it, is re-answered by the server on
 * arrival (ADR-035) — never assumed because a link was opened.
 */

/**
 * Render the Moment screen.
 *
 * @returns The element.
 */
export function MomentScreen(): React.JSX.Element {
  const route = useRoute<RouteProp<MainRoutes, "moment">>();
  const momentId = route.params?.momentId;

  if (momentId === undefined) {
    // The link carried something that was not an identifier. `linking.ts`
    // refused to pass it on, which is why there is nothing here to ask about.
    return (
      <Screen centred testID="moment-unopenable">
        <EmptyState action="Check the link and try again." title="This link cannot be opened" />
      </Screen>
    );
  }

  return (
    <Screen centred testID="moment-screen">
      <EmptyState action="Opening a Moment in full arrives with the next phase." title="Moment" />
    </Screen>
  );
}
