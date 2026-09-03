import { getMoment } from "../../moments/queries/get-moment.query.js";
import {
  commentConnectionFor,
  mediaConnectionFor,
  momentFor,
  reactionSummaryFor,
  relationshipFor,
  significanceFor,
  type CommentShape,
  type Connection,
  type MediaShape,
  type MomentShape,
  type PersonalSignificanceShape,
  type ReactionSummaryShape,
} from "../../moments/services/moment-composer.js";
import {
  commentRequestFrom,
  mediaRequestFrom,
  relationshipLimitFrom,
  type CommentArguments,
  type MediaArguments,
  type RelationshipArguments,
} from "../../moments/services/moment-request.js";
import type { AuthorizedMoment } from "../../read-models/postgres/moment-read-model.js";
import type { GraphQLContext } from "../context/graphql-context.js";

/**
 * Reading one Moment.
 *
 * **Authorization happens once, and the parent carries the proof.** Only the
 * read model's check produces an `AuthorizedMoment`, and the fields that read
 * further take one — so a field cannot be reached without access having been
 * established, and has nowhere to establish it again.
 *
 * That is the difference between this and the REST surface it composes. There,
 * comments, reactions, relationships and the significance mark are four separate
 * requests, and each re-runs the Moment's access gate because it cannot know the
 * last one did. Here they are four fields of one request, and running the gate
 * again would be four proofs of one fact — with four chances for one of them to
 * disagree with the others.
 *
 * Everything one-to-one with the Moment is composed once, when the Moment is
 * read: the author, the occurrence, the place reduced to what this reader may be
 * told, and their own significance mark. GraphQL's default resolvers serve those
 * from the object. Only the four fields that need another statement have
 * resolvers, and each costs nothing unless a client selects it.
 */

/**
 * A Moment as its fields receive it.
 *
 * The composed shape, plus the proof of access the reading fields need.
 * `authorized` is not in the schema, so no client can ask for it — the same way
 * a Timeline entry carries `readable` without exposing it.
 */
export interface MomentParent extends MomentShape {
  readonly personalSignificance: PersonalSignificanceShape;
  readonly authorized: AuthorizedMoment;
}

/** What `Query.moment` receives. */
interface MomentArguments {
  readonly id: string;
}

/** The Moment field on `Query`. */
export const momentQueries = {
  /**
   * One Moment, in full.
   *
   * @param _parent - Unused; this is a root field.
   * @param args - Which Moment.
   * @param context - Carries the Viewer, what they may see, and the read models.
   * @returns The Moment, or null when this reader may not have it — which covers
   *   every reason at once, deliberately: no such Moment, private, blocked, not
   *   on its list, or withheld. Telling them apart would disclose which applied.
   * @throws {ValidationError} If the identifier is not one.
   * @throws {UnauthenticatedError} If the request offered no credential.
   * @throws {OnboardingRequiredError} If onboarding is unfinished.
   */
  async moment(
    _parent: unknown,
    args: MomentArguments,
    context: GraphQLContext,
  ): Promise<MomentParent | null> {
    const authorized = await getMoment(args.id, context);

    if (authorized === null) {
      return null;
    }

    return {
      ...momentFor(authorized.row, authorized.viewerUserId),
      personalSignificance: significanceFor(authorized.row),
      authorized,
    };
  },
};

/**
 * The fields of a Moment that need another statement.
 *
 * Everything else is served from the object by GraphQL's default resolvers,
 * because it came back with the Moment.
 */
export const momentFields = {
  /**
   * A page of the Moment's media.
   *
   * @param parent - The composed Moment, carrying its proof of access.
   * @param args - How many, and where to resume.
   * @param context - Carries the read model.
   * @returns The page, in the order the author arranged it.
   * @throws {ValidationError} If the page size is outside the contract's bound,
   *   or the cursor belongs to another sequence or another Moment.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async media(
    parent: MomentParent,
    args: MediaArguments,
    context: GraphQLContext,
  ): Promise<Connection<MediaShape>> {
    const request = mediaRequestFrom(args, parent.momentId);
    // No Viewer reaches this statement. Reaching here means access was
    // established, and asking again would be a second authorization.
    const slice = await context.moments.media(parent.authorized, request.limit, request.after);

    return mediaConnectionFor(slice, parent.momentId, request.after !== undefined);
  },

  /**
   * A page of the discussion, oldest first.
   *
   * @param parent - The composed Moment, carrying its proof of access.
   * @param args - How many, where to resume, and whose replies.
   * @param context - Carries the read model.
   * @returns The page, with the total as a function so it costs a statement
   *   only when asked for.
   * @throws {ValidationError} If the page size is outside the contract's bound,
   *   or the cursor belongs to another sequence.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async comments(
    parent: MomentParent,
    args: CommentArguments,
    context: GraphQLContext,
  ): Promise<Connection<CommentShape> & { total: () => Promise<number> }> {
    const request = commentRequestFrom(args);
    const slice = await context.moments.comments(
      parent.authorized,
      request.limit,
      request.after,
      request.thread,
    );

    return {
      ...commentConnectionFor(slice, request.after !== undefined),
      // A function rather than a number, so counting a whole discussion — the
      // most expensive statement here and the least often wanted — happens only
      // when a client selects it.
      total: async () => context.moments.commentCount(parent.authorized),
    };
  },

  /**
   * How the Moment has been responded to.
   *
   * @param parent - The composed Moment, carrying its proof of access.
   * @param _args - Unused; the field takes none.
   * @param context - Carries the read model.
   * @returns The summary. When reactions are off no statement is issued: the
   *   answer is already known, and it is not zero.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async reactions(
    parent: MomentParent,
    _args: unknown,
    context: GraphQLContext,
  ): Promise<ReactionSummaryShape> {
    if (!parent.authorized.row.reactions_enabled) {
      return reactionSummaryFor([], false);
    }

    return reactionSummaryFor(await context.moments.reactions(parent.authorized), true);
  },

  /**
   * What the Moment is connected to.
   *
   * @param parent - The composed Moment, carrying its proof of access.
   * @param args - How many.
   * @param context - Carries the read model and the Viewer's facts.
   * @returns The claims, newest first. A far end withheld by privacy is absent
   *   entirely; one withheld by moderation is present and marked unavailable.
   * @throws {ValidationError} If the limit is outside the contract's bound.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async relationships(
    parent: MomentParent,
    args: RelationshipArguments,
    context: GraphQLContext,
  ): Promise<ReturnType<typeof relationshipFor>[]> {
    const limit = relationshipLimitFrom(args);
    const viewer = await context.eligibility.forViewer();
    const rows = await context.moments.relationships(parent.authorized, viewer.isAdult, limit);

    return rows.map(relationshipFor);
  },
};

/**
 * Which kind of media a row is.
 *
 * Decided from what a decoder found rather than from which fields are present: a
 * video whose duration was never recorded is still a video, and presenting it as
 * a photograph would lose the fact that it plays.
 */
export const mediaTypeResolver = {
  /**
   * Name the type.
   *
   * @param value - The media a resolver produced.
   * @returns The type name, matching the SDL.
   */
  resolveType(value: MediaShape): string {
    return value.kind === "video" ? "Video" : "Image";
  },
};
