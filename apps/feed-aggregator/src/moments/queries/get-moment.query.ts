import type { GraphQLContext } from "../../graphql/context/graphql-context.js";
import type { AuthorizedMoment } from "../../read-models/postgres/moment-read-model.js";
import { momentIdFrom } from "../services/moment-request.js";

/**
 * Opening a Moment.
 *
 * Three steps, and the middle one is worth naming: the Viewer's facts are
 * resolved once for the whole request, and the Moment is authorized once. What
 * comes back carries its own proof, so every field beneath it reads without
 * asking again.
 *
 * The identifier is checked before eligibility is resolved. That order is
 * deliberate: a refusal at this stage describes only what the client sent, where
 * resolving first would send an unchecked value to PostgreSQL — and a `uuid`
 * comparison against something that is not one raises rather than returning
 * nothing, which would surface as an internal error where a refusal was right.
 *
 * @param id - Which Moment, as the client named it.
 * @param context - Carries the Viewer, what they may see, and the read models.
 * @returns The Moment with its proof of access, or null. Null is the only
 *   refusal and it means every reason at once — there is no such Moment, it is
 *   private, its author blocked them, they are not on its list, or Chronologity
 *   withheld it. Telling them apart would disclose which one applied, and
 *   knowing an identifier has never granted access to what it names.
 * @throws {ValidationError} If the identifier is not one.
 * @throws {UnauthenticatedError} If the request offered no credential: reading
 *   history requires an account.
 * @throws {OnboardingRequiredError} If onboarding is unfinished.
 */
export async function getMoment(
  id: string,
  context: GraphQLContext,
): Promise<AuthorizedMoment | null> {
  const momentId = momentIdFrom(id);
  const viewer = await context.eligibility.forViewer();
  const found = await context.moments.findVisible(momentId, viewer.viewerUserId, viewer.isAdult);

  return found ?? null;
}
