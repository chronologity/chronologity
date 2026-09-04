import { visibleToViewer } from "./moment-access.js";
import type { ViewerPlaceholders } from "./placeholders.js";

/**
 * Whether a Viewer may know a real-world Event exists.
 *
 * **Derived rather than stored, and that is a decision about ownership.** Every
 * other visibility control in Chronologity hangs off something with an owner: a
 * Moment has an author, a Timeline has a person. An Event has neither — ADR-100
 * is explicit that recording one "confers no authority over anyone else's
 * history of it" — so there is nobody whose setting a visibility flag would be.
 * If two people recorded Moments at the same wedding and disagreed about whether
 * the occasion was private, a flag would have to pick one of them.
 *
 * So the rule reads one fact: can this Viewer read any Moment that was part of
 * it. Everything privacy, blocking, suspension, age and moderation decide is
 * therefore decided once, by `visibleToViewer`, and this inherits every future
 * change to that rule without being edited.
 *
 * It also fails in the safe direction where a flag would not.
 * `real-world-events.md:707` names the case: "a private wedding Event should not
 * become publicly discoverable merely because one participant accidentally
 * creates a public-facing association." A flag makes that possible; this cannot,
 * because an Event becomes visible only through history somebody was already
 * entitled to read.
 *
 * **The creator is admitted first, and it is not an ownership claim.** ADR-100's
 * `created_by_user_id` is provenance, and this grants exactly what provenance
 * should: you may read the record you caused to exist. It confers nothing over
 * anybody else's history of the occurrence. Without it, recording an Event and
 * reading it back would answer "no such Event" until somebody attached a Moment
 * — so the surface that records one could not confirm what it wrote.
 *
 * @param alias - The alias `real_world_events` is read under.
 * @param viewer - How this caller's client spells a bound value.
 * @returns A SQL condition, true when this Viewer may know the Event exists.
 */
export function realWorldEventVisibleTo(alias: string, viewer: ViewerPlaceholders): string {
  return `(
    ${alias}.created_by_user_id = ${viewer.viewerUserId}
    OR EXISTS (
      SELECT 1
        FROM moment_real_world_events mre
        JOIN moments m ON m.moment_id = mre.moment_id
       WHERE mre.real_world_event_id = ${alias}.real_world_event_id
         AND m.deleted_at IS NULL
         AND ${visibleToViewer("m", viewer)}
    )
  )`;
}
