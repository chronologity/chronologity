import type {
  Location,
  LocationDisclosure,
  Moment,
  MomentVisibility,
  Occurrence,
} from "@chronologity/contracts";

/** Feature-local types for Moments. */

/**
 * A Moment as stored, before anybody has decided how much of its place to tell.
 *
 * The repository cannot produce a `Moment`, because a `Moment` carries a place
 * already reduced for one particular Viewer and the repository does not know
 * who is asking. It returns this instead, and only `disclosePlace` turns it
 * into something that can be sent.
 *
 * That is the point of the type. A read path that forgot to reduce the place
 * would leak an exact position silently; here it fails to compile.
 */
export interface UndisclosedMoment extends Omit<Moment, "place"> {
  /** The place in full, or undefined when the Moment has none. */
  readonly location: Location | undefined;
  /** How much of it the author chose to tell everybody else. */
  readonly locationDisclosure: LocationDisclosure;
}

/** Everything established when a Moment is recorded. */
export interface NewMoment {
  readonly momentId: string;
  readonly authorUserId: string;
  readonly caption: string;
  readonly occurrence: Occurrence;
  readonly occurrenceOffsetMinutes: number;
  /** Already checked and positioned by the policy. */
  readonly media: readonly { uploadId: string; position: number }[];
  /** Who may see it, as the author asked at the time of recording. */
  readonly visibility: MomentVisibility;
  /** How much of its place other people are told, as asked at recording. */
  readonly locationDisclosure: LocationDisclosure;
  readonly createdAt: Date;
}

/**
 * What kind of change somebody made.
 *
 * Recorded rather than inferred from what changed, because the product treats
 * these differently: moving a Moment in time is a historical correction, while
 * a caption is enrichment (`moments.md:407`). A reader should not have to work
 * out which happened.
 */
export type MomentEditKind =
  | "caption_changed"
  | "occurrence_corrected"
  | "media_added"
  | "media_removed"
  | "media_reordered"
  | "deleted";
