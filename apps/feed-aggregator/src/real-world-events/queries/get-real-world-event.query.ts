import { identifierSchema } from "@chronologity/contracts";
import { ValidationError } from "../../errors/aggregator-error.js";
import type { GraphQLContext } from "../../graphql/context/graphql-context.js";
import {
  realWorldEventFor,
  type RealWorldEventShape,
} from "../services/real-world-event-composer.js";

/**
 * Opening one occurrence in the world.
 *
 * The identifier is checked before the Viewer is resolved: a refusal at that
 * stage describes only what the client sent, where resolving first would send an
 * unchecked value to a `uuid` comparison, which raises rather than returning
 * nothing.
 *
 * @param id - Which occurrence, as the client named it.
 * @param context - Carries the Viewer, what they may see, and the read model.
 * @returns The occasion, or null when this reader may not know it exists.
 * @throws {ValidationError} If the identifier is not one.
 * @throws {UnauthenticatedError} If the request offered no credential.
 * @throws {OnboardingRequiredError} If onboarding is unfinished.
 */
export async function getRealWorldEvent(
  id: string,
  context: GraphQLContext,
): Promise<RealWorldEventShape | null> {
  if (!identifierSchema.safeParse(id).success) {
    throw new ValidationError("That is not an occurrence identifier");
  }

  const facts = await context.eligibility.forViewer();
  const found = await context.realWorldEvents.findVisible(id, facts.viewerUserId, facts.isAdult);

  return found === undefined ? null : realWorldEventFor(found);
}
