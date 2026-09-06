import type { TimelineEntry } from "./get-timeline-slice.query";

/**
 * Where a Timeline opens.
 *
 * The newest **occurrence** it holds, which is deliberately not the newest
 * recording: a photograph added today of 1969 belongs in 1969, and treating the
 * upload as the head would put somebody at the wrong end of their own history
 * the moment they backfilled anything.
 *
 * Null when the view holds nothing — including a Timeline its owner has closed,
 * which answers as though empty rather than refusing. Refusing would itself say
 * something was there.
 */
export const GET_TIMELINE_HEAD = `
  query GetTimelineHead($view: TimelineViewInput!) {
    timelineHead(view: $view) {
      __typename
      ... on ReadableTimelineEntry {
        momentId
        occurredAt
        occurrencePrecision
        occurrenceOffsetMinutes
        visibility
      }
      ... on WithheldTimelineEntry {
        momentId
        occurredAt
        occurrencePrecision
      }
    }
  }
`;

/** Where the Timeline opens, or nothing. */
export interface TimelineHead {
  readonly timelineHead: TimelineEntry | null;
}
