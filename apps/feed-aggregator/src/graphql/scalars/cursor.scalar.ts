import { CursorError } from "@chronologity/timeline-derivation";
import { GraphQLError, Kind, type ValueNode } from "graphql";
import { decodePosition, encodePosition, type Position } from "../../pagination/cursors.js";

/**
 * Where a page of history resumes.
 *
 * Opaque by contract. It names a position, and its shape is this service's
 * business rather than a client's — `feed.md:562` says a client must not depend
 * on the internal structure, and the encoding is versioned so it can change.
 *
 * Its own scalar rather than `String` for one reason worth the file: a cursor
 * arriving from a client is untrusted, and this is where that is dealt with.
 * A tampered or stale one is refused here, at the boundary, before any resolver
 * sees it — and refused *semantically*.
 *
 * That last part is what this fixes. `decodeCursor` throws the shared package's
 * `CursorError`, which is deliberately not one of this application's errors:
 * the package is shared with `apps/api` and must not choose an HTTP status or a
 * GraphQL shape on its behalf. But `format-errors.ts` preserves a message only
 * for an error it recognises, so a `CursorError` reaching it unwrapped became
 * "An unexpected error occurred" — precisely what `feed.md:578` forbids, and
 * indistinguishable to a client from the service falling over.
 *
 * The message says the cursor is unusable and nothing about what the encoding
 * contains. Somebody probing learns that their string was refused, which they
 * knew.
 */

/** What a refused cursor is classified as, from the vocabulary clients already read. */
const REFUSED = "VALIDATION_FAILED";

/**
 * Turn a cursor a client supplied into the position it names.
 *
 * @param value - Whatever arrived, from a variable or inline in the document.
 * @returns The position.
 * @throws {GraphQLError} If it is not a string, or not a cursor this Timeline
 *   issued. Carries the stable code the error formatter reads, so the client
 *   receives a refusal rather than an internal error.
 */
function parse(value: unknown): Position {
  if (typeof value !== "string") {
    throw refuse("A cursor is a string");
  }

  try {
    return decodePosition(value);
  } catch (error) {
    // The package's message is already written to be shown — "not a usable
    // cursor", or one from an encoding this Timeline cannot read — and says
    // nothing about base64 or JSON. Anything else is not ours to describe.
    throw refuse(error instanceof CursorError ? error.message : "That is not a usable cursor");
  }
}

/**
 * Build the refusal.
 *
 * @param message - What to tell the client. Never quotes the cursor back: a
 *   value echoed into an error is a value that reaches a log.
 * @returns The error to throw.
 */
function refuse(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: REFUSED } });
}

/**
 * The `Cursor` scalar's behaviour.
 *
 * A plain object rather than a `GraphQLScalarType` instance, because Mercurius
 * attaches a scalar by copying every own property of this value onto the type
 * it already built from the SDL. Handing it an instance would copy `name` and
 * `astNode` across as well, which is more mutation than this needs.
 *
 * Both `parseValue` and `parseLiteral` are supplied because GraphQL derives
 * neither from the other: a cursor sent as a variable takes the first, one
 * written into the document takes the second, and a client will do both.
 *
 * One scalar serves every connection, so what it decodes is a position of some
 * kind rather than a Timeline position. Which kind a given connection can use is
 * that connection's business — `expectKind` is where a cursor from the wrong one
 * is refused, because the scalar cannot know which field it is being read for.
 */
export const cursorScalar = {
  /**
   * Send a position to a client.
   *
   * @param value - The position a resolver produced.
   * @returns Its encoded form.
   * @throws {GraphQLError} If a resolver returned something that is not a
   *   position, which is a defect here rather than in the request.
   */
  serialize(value: unknown): string {
    if (typeof value !== "object" || value === null || !("kind" in value)) {
      throw new GraphQLError("A cursor could not be produced", {
        extensions: { code: "INTERNAL_ERROR" },
      });
    }

    return encodePosition(value as Position);
  },

  /**
   * Read a cursor supplied as a variable.
   *
   * @param value - The variable's value.
   * @returns The position it names.
   * @throws {GraphQLError} If it is not a cursor this Timeline issued.
   */
  parseValue(value: unknown): Position {
    return parse(value);
  },

  /**
   * Read a cursor written into the query document.
   *
   * @param node - The literal, as parsed.
   * @returns The position it names.
   * @throws {GraphQLError} If it is not a string literal, or not a cursor this
   *   Timeline issued.
   */
  parseLiteral(node: ValueNode): Position {
    if (node.kind !== Kind.STRING) {
      throw refuse("A cursor is a string");
    }

    return parse(node.value);
  },
};
