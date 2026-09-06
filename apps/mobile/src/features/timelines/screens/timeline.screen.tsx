import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { ErrorState } from "../../../components/feedback/error-state";
import { useBackend } from "../../../app/providers";
import {
  GET_TIMELINE_SLICE,
  type TimelineEntry,
  type TimelineSlice,
} from "../../../lib/graphql/queries/get-timeline-slice.query";
import { GET_VIEWER, type ViewerResult } from "../../../lib/graphql/queries/get-viewer.query";

/**
 * One page of somebody's own history.
 *
 * The bootstrap's proof that everything downstream of a token actually works:
 * the Session is live, the aggregator accepts it, and real Moments come back in
 * the order they happened.
 *
 * **Two queries, and the first one is not a formality.** Whose Timeline this is
 * comes from the aggregator, because the client does not know: a Session
 * identifier names one sign-in on one device, not the account behind it. Asking
 * also distinguishes somebody signed in without an account yet — `userId` null,
 * which is `ONBOARDING_REQUIRED` as the read surface expresses it — from
 * somebody whose history is genuinely empty.
 *
 * **Chronological, and only chronological.** The order is the order the server
 * returned, and nothing here sorts, scores, or promotes anything — the Timeline
 * is chronological rather than ranked, which is the product's first invariant.
 *
 * **Withheld is rendered as withheld.** ADR-140 made an unreadable Moment its
 * own type so a client cannot mistake it for an absent one, and this branches on
 * `__typename` accordingly. Showing a gap instead would misstate the shape of a
 * period; showing it as readable would be a leak. Neither is a rendering
 * detail.
 *
 * Paging, temporal zoom and horizontal navigation are Phase 12's. What this
 * proves is the seam.
 */

/**
 * Render the Timeline.
 *
 * @returns The element.
 */
export function TimelineScreen(): React.JSX.Element {
  const { graphql } = useBackend();

  // Asked rather than assumed. A Session identifier names one sign-in, not a
  // person, and a PERSON scope needs the account.
  const viewer = useQuery({
    queryKey: ["viewer"],
    queryFn: async ({ signal }) => await graphql.query<ViewerResult>(GET_VIEWER, {}, signal),
  });

  const userId = viewer.data?.viewer.userId ?? undefined;

  const timeline = useQuery({
    queryKey: ["timeline", userId],
    queryFn: async ({ signal }) =>
      await graphql.query<TimelineSlice>(
        GET_TIMELINE_SLICE,
        {
          view: { scope: { type: "PERSON", id: userId ?? "" } },
          first: 50,
        },
        signal,
      ),
    enabled: userId !== undefined,
  });

  if (viewer.isError) {
    return <ErrorState error={viewer.error} />;
  }

  // Signed in, with no account yet. Not a failure, and emphatically not a
  // reason to send somebody back to signing in (ADR-139).
  if (viewer.isSuccess && userId === undefined) {
    return (
      <View style={styles.centred} testID="timeline-onboarding">
        <Text style={styles.empty}>There is one more step before your Timeline is ready.</Text>
      </View>
    );
  }

  if (viewer.isPending || timeline.isPending) {
    return (
      <View style={styles.centred} testID="timeline-loading">
        <ActivityIndicator />
      </View>
    );
  }

  if (timeline.isError) {
    // Never an empty Timeline. An outage and a life with nothing recorded in it
    // are opposite situations (ADR-151).
    return <ErrorState error={timeline.error} />;
  }

  const edges = timeline.data.timeline.edges;

  if (edges.length === 0) {
    return (
      <View style={styles.centred} testID="timeline-empty">
        <Text style={styles.empty}>Nothing here yet. Your history starts with a Moment.</Text>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={edges}
      keyExtractor={(edge) => edge.cursor}
      renderItem={({ item }) => <Entry entry={item.node} />}
      testID="timeline"
    />
  );
}

/**
 * One row.
 *
 * @param props - The entry to render.
 * @param props.entry - Readable or withheld; the two look different on purpose.
 * @returns The element.
 */
function Entry({ entry }: { entry: TimelineEntry }): React.JSX.Element {
  const when = new Date(entry.occurredAt).toDateString();

  if (entry.__typename === "WithheldTimelineEntry") {
    return (
      <View style={styles.row} testID="timeline-entry-withheld">
        <Text style={styles.when}>{when}</Text>
        <Text style={styles.withheld}>Not yours to read</Text>
      </View>
    );
  }

  return (
    <View style={styles.row} testID="timeline-entry">
      <Text style={styles.when}>{when}</Text>
      <Text style={styles.detail}>{entry.occurrencePrecision.toLowerCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centred: { alignItems: "center", flex: 1, justifyContent: "center", padding: 32 },
  detail: { color: "#666", fontSize: 13 },
  empty: { color: "#444", textAlign: "center" },
  list: { padding: 16 },
  row: { borderBottomColor: "#eee", borderBottomWidth: 1, paddingVertical: 14 },
  when: { fontSize: 16, fontWeight: "600" },
  withheld: { color: "#999", fontSize: 13, fontStyle: "italic" },
});
