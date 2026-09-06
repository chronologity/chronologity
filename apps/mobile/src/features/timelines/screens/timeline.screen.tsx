import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { ErrorState } from "../../../components/feedback/error-state";
import { useBackend } from "../../../app/providers";
import {
  GET_TIMELINE_SLICE,
  type TimelineEntry,
  type TimelineSlice,
} from "../../../lib/graphql/queries/get-timeline-slice.query";

/**
 * One page of somebody's own history.
 *
 * The bootstrap's proof that everything downstream of a token actually works:
 * the Session is live, the aggregator accepts it, and real Moments come back in
 * the order they happened.
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
  const { graphql, session } = useBackend();
  const userId = session.current()?.sessionId;

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

  if (timeline.isPending) {
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
