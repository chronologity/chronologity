import { getAdjacentContexts } from "../../timelines/queries/get-adjacent-contexts.query.js";
import { getRealWorldEvent } from "../../real-world-events/queries/get-real-world-event.query.js";
import type { AxisConnection } from "../../timelines/services/context-axis.js";
import type { AxisArguments } from "../../timelines/services/context-request.js";
import type { RealWorldEventShape } from "../../real-world-events/services/real-world-event-composer.js";
import type { GraphQLContext } from "../context/graphql-context.js";

/**
 * Moving sideways, and opening what you find.
 *
 * Thin by rule: each field unpacks its arguments and calls the composition
 * function that owns the work.
 */

/** What `Query.realWorldEvent` receives. */
interface EventArguments {
  readonly id: string;
}

/** The horizontal fields on `Query`. */
export const contextQueries = {
  /**
   * A stretch of the horizontal axis.
   *
   * @param _parent - Unused; this is a root field.
   * @param args - Where the reader is standing, when, and how much they want.
   * @param context - Carries the Viewer, what they may see, and the read models.
   * @returns The contexts they can move to, shared history first.
   * @throws {ValidationError} If the scope is a person, or the arguments are
   *   otherwise not a place on the axis.
   * @throws {UnauthenticatedError} If the request offered no credential.
   * @throws {OnboardingRequiredError} If onboarding is unfinished.
   */
  async adjacentContexts(
    _parent: unknown,
    args: AxisArguments,
    context: GraphQLContext,
  ): Promise<AxisConnection> {
    return getAdjacentContexts(args, context);
  },

  /**
   * One occurrence in the world.
   *
   * @param _parent - Unused; this is a root field.
   * @param args - Which occurrence.
   * @param context - Carries the Viewer, what they may see, and the read model.
   * @returns The occasion, or null when this reader may not know it exists —
   *   which covers both reasons at once, deliberately.
   * @throws {ValidationError} If the identifier is not one.
   * @throws {UnauthenticatedError} If the request offered no credential.
   * @throws {OnboardingRequiredError} If onboarding is unfinished.
   */
  async realWorldEvent(
    _parent: unknown,
    args: EventArguments,
    context: GraphQLContext,
  ): Promise<RealWorldEventShape | null> {
    return getRealWorldEvent(args.id, context);
  },
};
