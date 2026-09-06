import { useQuery } from "@tanstack/react-query";
import { FlatList, View } from "react-native";
import { spacing } from "../../../app/theme/spacing";
import { EmptyState } from "../../../components/feedback/empty-state";
import { ErrorState } from "../../../components/feedback/error-state";
import { Screen } from "../../../components/layout/screen";
import { AppLoader } from "../../../components/primitives/app-loader";
import { AppText } from "../../../components/primitives/app-text";
import { useTheme } from "../../../hooks/use-theme";
import { formatOccurrence, type Precision } from "../../../lib/utils/format-date";
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

  // Every link in this chain is optional, and that is not defensive habit. A
  // GraphQL response is not parsed the way a REST one is — `packages/contracts`
  // validates those, and these documents are hand-written with hand-written
  // types beside them (ADR-154) — so a field that is absent arrives as
  // `undefined` rather than as a refusal. Reaching through it crashes the
  // screen, which is the one failure mode worse than showing an error.
  const userId = viewer.data?.viewer?.userId ?? undefined;
  const answered = viewer.isSuccess && viewer.data?.viewer !== undefined;

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
  if (answered && userId === undefined) {
    return (
      <Screen centred testID="timeline-onboarding">
        <EmptyState
          action="Finish setting up your account and your history will appear here."
          title="One more step"
        />
      </Screen>
    );
  }

  // A success that carried no `viewer` is a malformed answer, not an empty one.
  // Waiting is the honest thing to render: the query will settle or fail, and
  // either is better than deciding on a shape that is not there.
  if (viewer.isPending || !answered || timeline.isPending) {
    return (
      <Screen centred testID="timeline-loading">
        <AppLoader label="Loading your Timeline" />
      </Screen>
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
      <Screen centred testID="timeline-empty">
        <EmptyState action="Your history starts with a Moment." title="Nothing here yet" />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <FlatList
        contentContainerStyle={{ padding: spacing.lg }}
        data={edges}
        keyExtractor={(edge) => edge.cursor}
        renderItem={({ item }) => <Entry entry={item.node} />}
        testID="timeline"
      />
    </Screen>
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
  const { theme } = useTheme();

  // At the precision it is actually known. A Moment recorded as "summer 1998"
  // must not be rendered as a day nobody knows (moments.md:259).
  const when = formatOccurrence(entry.occurredAt, entry.occurrencePrecision as Precision);

  const row = {
    borderBottomColor: theme.colors.border,
    borderBottomWidth: 1,
    gap: spacing.xs,
    paddingVertical: spacing.md,
  };

  if (entry.__typename === "WithheldTimelineEntry") {
    return (
      <View style={row} testID="timeline-entry-withheld">
        <AppText variant="body">{when}</AppText>
        {/*
          The words carry this, not the colour. Colour "must not be the only way
          meaning is communicated" (accessibility.md:828), and this is the row
          whose meaning is somebody else's privacy — it was also the least
          legible thing on the screen at 2.8:1 before the palette existed.
        */}
        <AppText color="textMuted" variant="caption">
          Not yours to read
        </AppText>
      </View>
    );
  }

  return (
    <View style={row} testID="timeline-entry">
      <AppText variant="body">{when}</AppText>
    </View>
  );
}
