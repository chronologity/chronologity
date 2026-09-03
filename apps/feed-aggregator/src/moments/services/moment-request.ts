import {
  identifierSchema,
  listCommentsRequestSchema,
  listMomentMediaRequestSchema,
  listMomentRelationshipsRequestSchema,
} from "@chronologity/contracts";
import { ValidationError } from "../../errors/aggregator-error.js";
import { expectKind, type Position } from "../../pagination/cursors.js";

/**
 * What a client asked for, bounded and checked.
 *
 * Every bound here comes from `packages/contracts` rather than from a number
 * written beside the field it bounds. ADR-141 settled why: two bounds in two
 * places is the defect that shows up as one surface returning more than another
 * and nobody noticing until it matters.
 *
 * The cursor arrives already decoded — the scalar reads it at the boundary,
 * which is where an untrusted string belongs — but not yet *checked*. One scalar
 * serves three connections, so a Timeline cursor reaches a media argument as
 * readily as a media one, and it would decode to something plausible. Narrowing
 * it is this module's job.
 */

/** How many media, and where to resume. */
export interface MediaArguments {
  readonly first?: number | null;
  readonly after?: Position | null;
}

/** How many comments, where to resume, and whose replies. */
export interface CommentArguments {
  readonly first?: number | null;
  readonly after?: Position | null;
  readonly thread?: string | null;
}

/** How many relationships. */
export interface RelationshipArguments {
  readonly limit?: number | null;
}

/** A page of media, as the read model takes it. */
export interface MediaRequest {
  readonly limit: number;
  /** The position to resume past, or undefined to start at the beginning. */
  readonly after: number | undefined;
}

/** A page of discussion, as the read model takes it. */
export interface CommentRequest {
  readonly limit: number;
  readonly after: { createdAt: Date; commentId: string } | undefined;
  /** Whose replies are wanted, or undefined for the top level. */
  readonly thread: string | undefined;
}

/**
 * Read a Moment identifier a client supplied.
 *
 * @param id - Whatever arrived on the argument.
 * @returns The identifier.
 * @throws {ValidationError} If it is not one. Checked before it reaches a
 *   statement, because it is compared against a `uuid` column and PostgreSQL
 *   raises rather than returning nothing — which would surface as an internal
 *   error where a refusal was the right answer.
 */
export function momentIdFrom(id: string): string {
  const parsed = identifierSchema.safeParse(id);

  if (!parsed.success) {
    throw new ValidationError("That is not a Moment identifier");
  }

  return parsed.data;
}

/**
 * How much media to read, and from where.
 *
 * @param args - What the field was given.
 * @param momentId - Which Moment is being read, so a cursor from another one is
 *   refused rather than resumed at the same ordinal of a different sequence.
 * @returns The bounded request.
 * @throws {ValidationError} If the page size is outside what the contract
 *   allows, or the cursor belongs to a different sequence or a different Moment.
 */
export function mediaRequestFrom(args: MediaArguments, momentId: string): MediaRequest {
  const first = args.first ?? undefined;
  const supplied = args.after ?? undefined;
  const parsed = listMomentMediaRequestSchema.safeParse(
    first === undefined ? {} : { limit: first },
  );

  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "That is not a usable page");
  }

  if (supplied === undefined) {
    return { limit: parsed.data.limit, after: undefined };
  }

  const position = expectKind(supplied, "media");

  if (position.momentId !== momentId) {
    // Its ordinal would be meaningful here, which is exactly the problem: it
    // would resume a different Moment's sequence at a number that happens to
    // exist in this one.
    throw new ValidationError("That cursor is from another Moment's media");
  }

  return { limit: parsed.data.limit, after: position.position };
}

/**
 * How much discussion to read, and from where.
 *
 * @param args - What the field was given.
 * @returns The bounded request.
 * @throws {ValidationError} If the page size is outside what the contract
 *   allows, the thread is not an identifier, or the cursor belongs to a
 *   different sequence.
 */
export function commentRequestFrom(args: CommentArguments): CommentRequest {
  const first = args.first ?? undefined;
  const supplied = args.after ?? undefined;
  const thread = args.thread ?? undefined;
  const parsed = listCommentsRequestSchema.safeParse(
    first === undefined ? {} : { limit: first },
  );

  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "That is not a usable page");
  }

  if (thread !== undefined && !identifierSchema.safeParse(thread).success) {
    throw new ValidationError("That is not a comment identifier");
  }

  const position = supplied === undefined ? undefined : expectKind(supplied, "comment");

  return {
    limit: parsed.data.limit,
    after:
      position === undefined
        ? undefined
        : { createdAt: position.createdAt, commentId: position.commentId },
    thread,
  };
}

/**
 * How many relationships to read.
 *
 * @param args - What the field was given.
 * @returns The bounded count.
 * @throws {ValidationError} If it is outside what the contract allows.
 */
export function relationshipLimitFrom(args: RelationshipArguments): number {
  const limit = args.limit ?? undefined;
  const parsed = listMomentRelationshipsRequestSchema.safeParse(
    limit === undefined ? {} : { limit },
  );

  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "That is not a usable limit");
  }

  return parsed.data.limit;
}
