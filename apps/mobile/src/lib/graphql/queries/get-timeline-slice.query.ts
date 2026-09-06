/**
 * A page of somebody's history.
 *
 * **Written by hand, and typed by hand beside it.** ADR-154 declined to
 * generate GraphQL types or to create a package to hold them, because nothing
 * but this application consumes the schema. That decision reopens when a second
 * consumer exists; until then a document and the shape it returns live together,
 * where a change to one is visibly a change to the other.
 *
 * **The union is the point.** ADR-140 made a Moment the reader may not see its
 * own type rather than the readable one with nullable fields, so a client
 * branches on `__typename` and can never mistake withheld for absent. The
 * document therefore asks for `__typename` first: without it the union cannot be
 * discriminated at all.
 *
 * **A page is bounded at 200 and defaults to 50** (ADR-141). Fifty is what a
 * screen can use; asking for more would cost the aggregator a bigger read for
 * rows nobody scrolls to.
 */
export const GET_TIMELINE_SLICE = `
  query GetTimelineSlice($view: TimelineViewInput!, $first: Int, $after: Cursor) {
    timeline(view: $view, first: $first, after: $after) {
      edges {
        cursor
        node {
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
      pageInfo {
        endCursor
        hasNextPage
      }
      scope {
        type
        id
      }
    }
  }
`;

/** A Moment this reader may open. */
export interface ReadableEntry {
  readonly __typename: "ReadableTimelineEntry";
  readonly momentId: string;
  readonly occurredAt: string;
  readonly occurrencePrecision: string;
  readonly occurrenceOffsetMinutes: number;
  readonly visibility: string;
}

/**
 * A Moment that is there and is not theirs to read.
 *
 * It carries when it happened and nothing about what it says — which is what
 * lets a Timeline stay honest about the shape of a period without disclosing
 * its contents.
 */
export interface WithheldEntry {
  readonly __typename: "WithheldTimelineEntry";
  readonly momentId: string;
  readonly occurredAt: string;
  readonly occurrencePrecision: string;
}

export type TimelineEntry = ReadableEntry | WithheldEntry;

/** One page, as the connection convention returns it. */
export interface TimelineSlice {
  readonly timeline: {
    readonly edges: ReadonlyArray<{ readonly cursor: string; readonly node: TimelineEntry }>;
    readonly pageInfo: {
      readonly endCursor: string | null;
      readonly hasNextPage: boolean;
    };
    readonly scope: { readonly type: string; readonly id: string };
  };
}
