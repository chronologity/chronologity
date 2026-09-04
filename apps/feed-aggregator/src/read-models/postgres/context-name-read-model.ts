import { PositionalParameters, realWorldEventVisibleTo, visibleToViewer } from "@chronologity/moment-access";
import type { Pool } from "pg";

/**
 * Giving a context back its name.
 *
 * ClickHouse knows a context's identity and nothing about what it is called —
 * the projection holds membership and ordering, deliberately, so a rename never
 * needs a reprojection. So the axis is found there and named here.
 *
 * **Naming is also where a place is confirmed**, and that is the important part
 * rather than an incidental one. A Moment can be perfectly readable while the
 * place it happened is withheld: somebody records at their flat, marks it part
 * of a public convention, and sets the place to hidden. The edge is well-formed
 * — the Moment can be read — but naming that flat is exactly the "context label"
 * `privacy.md:279` forbids. The secret is not the Location record, which is
 * already searchable; it is the association.
 *
 * `location_disclosure` lives on the Moment rather than on the place, and is not
 * in the projection at all. Since names must be fetched here regardless, this is
 * where the confirmation belongs: a place is named only when some Moment
 * connecting it to the anchor disclosed it exactly, or when the reader is that
 * Moment's author. A candidate that cannot be confirmed is dropped.
 *
 * An Event needs no such gate — its places are its own declaration rather than
 * anybody's association — but it does need its visibility resolved, which is the
 * same derived rule the API applies.
 */

/** A context, resolved to something a reader can be shown. */
export interface NamedContext {
  readonly contextType: string;
  readonly contextId: string;
  readonly name: string;
}

/** A context the axis found, before it is known whether it can be named. */
export interface ContextCandidate {
  readonly contextType: string;
  readonly contextId: string;
}

/**
 * Resolves context names, confirming what may be named at all.
 */
export class ContextNameReadModel {
  /**
   * Build the read model.
   *
   * @param pool - The read-only connection this application holds.
   */
  constructor(private readonly pool: Pool) {}

  /**
   * Name what may be named, and drop the rest.
   *
   * Two statements rather than one union, because the two questions are
   * genuinely different: a place is confirmed against the Moments tying it to
   * the anchor, and an Event against whether the reader may know it exists at
   * all. Folding them together would need one predicate that means two things.
   *
   * @param candidates - What the axis found, in the order it found them.
   * @param anchor - Where the reader is standing. A place reached through
   *   shared history must be connected to it by a Moment that disclosed where
   *   it happened; a place reached through the same period has no such
   *   connection to protect, and is confirmed against its own history instead.
   * @param tier - Which tier these candidates came from, which decides which of
   *   those two questions is asked.
   * @param viewerUserId - Who is asking.
   * @param viewerIsAdult - Whether they are old enough for age-restricted
   *   history.
   * @returns The subset that may be named, keyed for the caller to reorder.
   *   Order is not preserved: the caller holds the axis's ordering and this
   *   answers only what each context is called.
   * @throws {Error} If PostgreSQL refuses a statement.
   */
  async name(
    candidates: readonly ContextCandidate[],
    anchor: ContextCandidate,
    tier: "shared" | "period",
    viewerUserId: string,
    viewerIsAdult: boolean,
  ): Promise<Map<string, NamedContext>> {
    const places = candidates.filter((one) => one.contextType === "location");
    const occasions = candidates.filter((one) => one.contextType === "real_world_event");

    const [named, occasioned] = await Promise.all([
      places.length === 0
        ? []
        : this.places(
            places.map((one) => one.contextId),
            tier === "shared" ? anchor : undefined,
            viewerUserId,
            viewerIsAdult,
          ),
      occasions.length === 0
        ? []
        : this.occasions(
            occasions.map((one) => one.contextId),
            viewerUserId,
            viewerIsAdult,
          ),
    ]);

    return new Map(
      [...named, ...occasioned].map((one) => [`${one.contextType}:${one.contextId}`, one]),
    );
  }

  /**
   * Places some readable Moment actually disclosed.
   *
   * **What the anchor changes is which Moment has to have disclosed it.** A
   * place reached through shared history is being named as somewhere connected
   * to where the reader is standing, and that association is the secret — so a
   * Moment tying the two together has to have disclosed where it happened. A
   * place reached through the same period is connected to the anchor by
   * nothing; naming it says only that it has history, so its own Moments answer
   * for it.
   *
   * Both are the same gate: a place whose every readable Moment withheld it is
   * never named. They differ only in which Moments count.
   *
   * @param locationIds - The candidates.
   * @param anchor - What the disclosing Moment must also belong to, or
   *   undefined when the candidate is not being named as connected to anything.
   * @param viewerUserId - Who is asking.
   * @param viewerIsAdult - Whether they are old enough.
   * @returns The places that may be named.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  private async places(
    locationIds: readonly string[],
    anchor: ContextCandidate | undefined,
    viewerUserId: string,
    viewerIsAdult: boolean,
  ): Promise<NamedContext[]> {
    const bind = new PositionalParameters();
    const viewer = {
      viewerUserId: bind.bind(viewerUserId),
      viewerIsAdult: bind.bind(viewerIsAdult),
    };
    const ids = bind.bind([...locationIds]);
    // The anchor is a place or an occasion, and which one decides how a Moment
    // is tied to it. Written as two branches rather than a union, because a
    // Moment has at most one place and any number of occasions.
    const tiedToAnchor =
      anchor === undefined
        ? "TRUE"
        : anchor.contextType === "location"
          ? `EXISTS (SELECT 1 FROM moment_locations anchor_place
                      WHERE anchor_place.moment_id = m.moment_id
                        AND anchor_place.location_id = ${bind.bind(anchor.contextId)})`
          : `EXISTS (SELECT 1 FROM moment_real_world_events anchor_event
                      WHERE anchor_event.moment_id = m.moment_id
                        AND anchor_event.real_world_event_id = ${bind.bind(anchor.contextId)})`;

    const result = await this.pool.query<{ context_id: string; name: string }>(
      `SELECT l.location_id AS context_id, l.name AS name
         FROM locations l
        WHERE l.location_id = ANY(${ids}::uuid[])
          AND EXISTS (
            SELECT 1
              FROM moment_locations ml
              JOIN moments m ON m.moment_id = ml.moment_id
             WHERE ml.location_id = l.location_id
               AND m.deleted_at IS NULL
               AND ${visibleToViewer("m", viewer)}
               -- The disclosure gate. An author always receives their own
               -- places exactly, whatever they chose to tell everybody else.
               AND (m.author_user_id = ${viewer.viewerUserId}
                    OR m.location_disclosure = 'exact')
               AND ${tiedToAnchor}
          )`,
      [...bind.values],
    );

    return result.rows.map((row) => ({
      contextType: "location",
      contextId: row.context_id,
      name: row.name,
    }));
  }

  /**
   * Occasions this reader may know exist.
   *
   * @param realWorldEventIds - The candidates.
   * @param viewerUserId - Who is asking.
   * @param viewerIsAdult - Whether they are old enough.
   * @returns The occasions that may be named.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  private async occasions(
    realWorldEventIds: readonly string[],
    viewerUserId: string,
    viewerIsAdult: boolean,
  ): Promise<NamedContext[]> {
    const bind = new PositionalParameters();
    const viewer = {
      viewerUserId: bind.bind(viewerUserId),
      viewerIsAdult: bind.bind(viewerIsAdult),
    };
    const ids = bind.bind([...realWorldEventIds]);

    const result = await this.pool.query<{ context_id: string; name: string }>(
      `SELECT e.real_world_event_id AS context_id, e.name AS name
         FROM real_world_events e
        WHERE e.real_world_event_id = ANY(${ids}::uuid[])
          AND ${realWorldEventVisibleTo("e", viewer)}`,
      [...bind.values],
    );

    return result.rows.map((row) => ({
      contextType: "real_world_event",
      contextId: row.context_id,
      name: row.name,
    }));
  }
}
