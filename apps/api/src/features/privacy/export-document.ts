/**
 * Shaping somebody's history into something they can keep.
 *
 * Pure, and the place the privacy claim of this sub-phase actually lives.
 * `architecture/privacy.md:1288` says an export must carry what the account is
 * entitled to receive without exposing other people's private data, internal
 * moderation evidence, secrets, or operational-only identifiers — and every one
 * of those exclusions is a decision made in this file rather than a filter
 * applied later.
 *
 * **Every builder constructs its output field by field.** None of them spreads
 * a row. That is the whole technique: a row carries an email address, an
 * Identity, a storage key, and a reporter, and the only reliable way to keep
 * those out of a file somebody downloads is for no code path to copy an object
 * wholesale. Tests hand these builders rows full of things that must not travel
 * and search the output for them.
 *
 * What the export deliberately does not contain, and why:
 *
 * - **Email addresses and Identities.** An account's own address is not history
 *   and somebody else's is not theirs to have.
 * - **Sessions, device tokens, and storage keys.** Credentials and operational
 *   identifiers, useless outside this system and dangerous inside it.
 * - **The reporter of a report about them.** 5N keeps reporter identity from
 *   the subject precisely so that reporting is safe; an export would be the
 *   easiest way around that.
 * - **Notifications and deliveries.** Operational records of being told, rather
 *   than history. What a notification described is already here as the Moment
 *   or comment it pointed at.
 */

/** Somebody named in an export, as the account could already see them. */
export interface ExportedPerson {
  readonly handle: string;
  readonly displayName: string;
}

/** The account itself. */
export interface ExportedAccount {
  readonly handle: string;
  readonly displayName: string;
  readonly biography: string | null;
  readonly dateOfBirth: string | null;
  readonly joinedAt: string;
  readonly preferences: {
    readonly autoplayVideos: boolean;
    readonly autoplaySound: boolean;
    readonly locale: string | null;
    readonly timeZone: string | null;
    readonly reducedMotion: boolean;
  };
}

/** A file that belonged to a Moment. */
export interface ExportedMedia {
  readonly uploadId: string;
  readonly kind: string;
  readonly contentType: string | null;
  readonly byteSize: number | null;
}

/** Where something happened, at the precision its author chose. */
export interface ExportedPlace {
  readonly name: string;
  readonly precision: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/** One Moment. */
export interface ExportedMoment {
  readonly momentId: string;
  readonly caption: string;
  readonly occurrence: {
    readonly start: string;
    readonly end: string;
    readonly precision: string;
    readonly offsetMinutes: number;
  };
  readonly visibility: string;
  readonly recordedAt: string;
  readonly place: ExportedPlace | null;
  readonly media: ExportedMedia[];
}

/** Something somebody wrote. */
export interface ExportedComment {
  readonly commentId: string;
  readonly momentId: string;
  readonly body: string;
  readonly writtenAt: string;
  readonly author: ExportedPerson;
}

/** Somebody's response to something. */
export interface ExportedReaction {
  readonly momentId: string;
  readonly kind: string;
  readonly at: string;
  readonly by: ExportedPerson;
}

/** An account row as the database holds it, sensitive parts included. */
export interface AccountSource {
  readonly handle: string;
  readonly displayName: string;
  readonly biography: string | null;
  readonly createdAt: Date;
  readonly dateOfBirth: string | null;
  readonly preferences: {
    readonly autoplayVideos: boolean;
    readonly autoplaySound: boolean;
    readonly locale: string | null;
    readonly timeZone: string | null;
    readonly reducedMotion: boolean;
  };
  /** Present so that the test can prove it does not come out the other side. */
  readonly email?: string;
  readonly identityId?: string;
}

/**
 * Shape the account.
 *
 * @param source - The row, address and Identity included.
 * @returns What the person may keep. The address is absent deliberately: it is
 *   how they sign in rather than something that happened to them, and an export
 *   is a record of a history rather than of an account's credentials.
 */
export function describeAccount(source: AccountSource): ExportedAccount {
  return {
    handle: source.handle,
    displayName: source.displayName,
    biography: source.biography,
    dateOfBirth: source.dateOfBirth,
    joinedAt: source.createdAt.toISOString(),
    preferences: {
      autoplayVideos: source.preferences.autoplayVideos,
      autoplaySound: source.preferences.autoplaySound,
      locale: source.preferences.locale,
      timeZone: source.preferences.timeZone,
      reducedMotion: source.preferences.reducedMotion,
    },
  };
}

/** A Moment row with everything hanging off it. */
export interface MomentSource {
  readonly momentId: string;
  readonly caption: string;
  readonly occurrenceStart: Date;
  readonly occurrenceEnd: Date;
  readonly occurrencePrecision: string;
  readonly occurrenceOffsetMinutes: number;
  readonly visibility: string;
  readonly createdAt: Date;
  readonly place: {
    readonly name: string;
    readonly precision: string;
    readonly latitude: number | null;
    readonly longitude: number | null;
  } | null;
  readonly media: readonly {
    readonly uploadId: string;
    readonly kind: string;
    readonly contentType: string | null;
    readonly byteSize: number | null;
    /** Present so that the test can prove it does not come out. */
    readonly storageKey?: string;
  }[];
}

/**
 * Shape one Moment.
 *
 * @param source - The row, its place, and its media.
 * @returns The Moment as history rather than as storage. Occurrence keeps its
 *   precision and its offset, because `product/privacy.md:776` asks that an
 *   export stay useful outside the application and a timestamp stripped of how
 *   precisely it was known is a claim the original never made.
 *
 *   Media appears by upload identifier and never by storage key: the key says
 *   where this system keeps a file, which is operational and useless to
 *   anybody holding the export.
 */
export function describeMoment(source: MomentSource): ExportedMoment {
  return {
    momentId: source.momentId,
    caption: source.caption,
    occurrence: {
      start: source.occurrenceStart.toISOString(),
      end: source.occurrenceEnd.toISOString(),
      precision: source.occurrencePrecision,
      offsetMinutes: source.occurrenceOffsetMinutes,
    },
    visibility: source.visibility,
    recordedAt: source.createdAt.toISOString(),
    place:
      source.place === null
        ? null
        : {
            name: source.place.name,
            precision: source.place.precision,
            latitude: source.place.latitude,
            longitude: source.place.longitude,
          },
    media: source.media.map((file) => ({
      uploadId: file.uploadId,
      kind: file.kind,
      contentType: file.contentType,
      byteSize: file.byteSize,
    })),
  };
}

/** A comment row with its author. */
export interface CommentSource {
  readonly commentId: string;
  readonly momentId: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly author: {
    readonly handle: string;
    readonly displayName: string;
    /** Present so that the test can prove neither comes out. */
    readonly userId?: string;
    readonly email?: string;
  };
}

/**
 * Shape one comment.
 *
 * @param source - The row and its author.
 * @returns The comment attributed by handle and display name — what the account
 *   could already see in the application, and nothing more. The author's
 *   account identifier is absent: it is an internal identifier, and an export
 *   that carried one would let somebody correlate people across exports in a
 *   way the product never let them.
 */
export function describeComment(source: CommentSource): ExportedComment {
  return {
    commentId: source.commentId,
    momentId: source.momentId,
    body: source.body,
    writtenAt: source.createdAt.toISOString(),
    author: {
      handle: source.author.handle,
      displayName: source.author.displayName,
    },
  };
}

/** Somebody having been part of a Moment, as an export presents it. */
export interface ExportedParticipation {
  readonly momentId: string;
  readonly status: string;
  readonly proposedAt: string;
  readonly resolvedAt: string | null;
  /**
   * Whether this is somebody saying the account was there, or the account
   * saying it of somebody else.
   */
  readonly direction: "named-me" | "i-named";
  readonly person: ExportedPerson;
}

/** A participation row with the other person in it. */
export interface ParticipationSource {
  readonly momentId: string;
  readonly status: string;
  readonly proposedAt: Date;
  readonly resolvedAt: Date | null;
  readonly direction: "named-me" | "i-named";
  readonly person: {
    readonly handle: string;
    readonly displayName: string;
    /** Present so that the test can prove neither comes out. */
    readonly userId?: string;
    readonly email?: string;
  };
}

/**
 * Shape one participation.
 *
 * @param source - The row and the other person in it.
 * @returns It, attributed by handle and display name.
 *
 *   Unanswered proposals are included. A question somebody asked about where
 *   this account was is a record about them whether or not they ever answered
 *   it, and an export that showed only the answered ones would hide exactly the
 *   claims they had chosen not to confirm.
 */
export function describeParticipation(source: ParticipationSource): ExportedParticipation {
  return {
    momentId: source.momentId,
    status: source.status,
    proposedAt: source.proposedAt.toISOString(),
    resolvedAt: source.resolvedAt === null ? null : source.resolvedAt.toISOString(),
    direction: source.direction,
    person: { handle: source.person.handle, displayName: source.person.displayName },
  };
}

/** A perspective on history somebody kept, as an export presents it. */
export interface ExportedSavedView {
  readonly title: string;
  readonly savedAt: string;
  /**
   * When they last opened it, absent if they never did.
   *
   * A fact about their own behaviour, on their own row, disclosing nothing about
   * anybody else — so leaving it out would be incomplete in the way leaving out
   * `savedAt` would be.
   */
  readonly lastVisitedAt?: string;
  /**
   * The specification, verbatim.
   *
   * A Saved View *is* its specification, so an export that summarised it would
   * hand somebody a description of their view rather than the view. This is the
   * one place an export carries a structured object rather than prose, and it
   * is because the object is the thing.
   */
  readonly view: unknown;
}

/** A saved view row. */
export interface SavedViewSource {
  readonly title: string;
  readonly createdAt: Date;
  readonly lastVisitedAt: Date | null;
  readonly specification: unknown;
}

/**
 * Shape one saved view.
 *
 * @param source - The stored row.
 * @returns It, with the specification unchanged.
 */
export function describeSavedView(source: SavedViewSource): ExportedSavedView {
  // How much was new is deliberately absent. It is derived, it is a hint, and
  // it is stale by construction — "14 new Moments" as of an unknown instant is a
  // number that was never quite true. More sharply, it is the one field that can
  // over-report Moments somebody may no longer see, and `saved-views.md` asks
  // that counts not leak inaccessible history. Everywhere else a sweep corrects
  // that within the hour; an export is a file that outlives any correction.
  return {
    title: source.title,
    savedAt: source.createdAt.toISOString(),
    ...(source.lastVisitedAt === null ? {} : { lastVisitedAt: source.lastVisitedAt.toISOString() }),
    view: source.specification,
  };
}

/** A reaction row with the person who made it. */
export interface ReactionSource {
  readonly momentId: string;
  readonly kind: string;
  readonly createdAt: Date;
  readonly by: {
    readonly handle: string;
    readonly displayName: string;
    readonly userId?: string;
    readonly email?: string;
  };
}

/**
 * Shape one reaction.
 *
 * @param source - The row and who made it.
 * @returns The reaction, attributed the same way a comment is.
 */
export function describeReaction(source: ReactionSource): ExportedReaction {
  return {
    momentId: source.momentId,
    kind: source.kind,
    at: source.createdAt.toISOString(),
    by: {
      handle: source.by.handle,
      displayName: source.by.displayName,
    },
  };
}

/**
 * Shape somebody named in a relationship.
 *
 * @param source - Their public details, and whatever else the row carried.
 * @returns Them, by handle and display name.
 */
export function describePerson(source: {
  handle: string;
  displayName: string;
  userId?: string;
  email?: string;
}): ExportedPerson {
  return { handle: source.handle, displayName: source.displayName };
}
