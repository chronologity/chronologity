import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import {
  MomentPersonalSignificance,
  MomentSignificance,
} from "./moment-significance.model.js";
import type {
  CausalFacts,
  CollectiveFacts,
  EventFacts,
  EvidentiaryFacts,
  SignificanceDimension,
  SignificanceProvenance,
  StructuralFacts,
  TemporalFacts,
} from "./significance.scoring.js";

/** The global scope has no entity, so it is keyed on a constant rather than null. */
export const GLOBAL_SCOPE_ID = "00000000-0000-0000-0000-000000000000";

/** Everything one Moment's significance is computed from. */
export interface SignificanceInputs {
  readonly momentId: string;
  readonly authorUserId: string;
  readonly causal: CausalFacts;
  readonly structural: StructuralFacts;
  readonly temporal: TemporalFacts;
  readonly collective: CollectiveFacts;
  readonly event: EventFacts;
  readonly evidentiary: EvidentiaryFacts;
  /** Who has marked it, so each mark lands in that person's own scope. */
  readonly markedBy: readonly string[];
  /** The Events and places it belongs to, which are scopes of their own. */
  readonly eventIds: readonly string[];
  readonly locationIds: readonly string[];
}

/** One value to store, already scored. */
export interface ScoredSignificance {
  readonly scopeType: "person" | "real_world_event" | "location" | "global";
  readonly scopeId: string;
  readonly dimension: SignificanceDimension;
  readonly value: number;
  readonly provenance: SignificanceProvenance;
}

/**
 * Reads what significance is computed from, and writes what it computed.
 *
 * Deliberately reaches nothing belonging to reactions or comments. The
 * architecture constraints ask that engagement remain separable "so that a
 * future optimization cannot casually turn reaction or view counts into
 * historical importance", and a repository that cannot see them cannot be
 * quietly changed to use them.
 */
export class MomentSignificanceRepository {
  /**
   * Build the significance repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction of their own.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Record that a Moment matters to somebody.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param userId - Who says so.
   * @param at - When.
   * @returns Nothing. Marking twice is the state already holding.
   */
  async mark(tx: Transaction, momentId: string, userId: string, at: Date): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(MomentPersonalSignificance)
      .values({ momentId, userId, markedAt: at })
      .orIgnore()
      .execute();
  }

  /**
   * Take a mark back.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param userId - Whose mark.
   * @returns Nothing. Unmarking one that was never marked is not an error.
   */
  async unmark(tx: Transaction, momentId: string, userId: string): Promise<void> {
    await tx.delete(MomentPersonalSignificance, { momentId, userId });
  }

  /**
   * Read somebody's own mark.
   *
   * @param momentId - Which Moment.
   * @param userId - Whose mark. Always the caller: there is no way to ask for
   *   anybody else's, which is what keeps this private.
   * @returns When they marked it, or undefined.
   */
  async markedAt(momentId: string, userId: string): Promise<Date | undefined> {
    const row = await this.dataSource
      .getRepository(MomentPersonalSignificance)
      .findOneBy({ momentId, userId });

    return row?.markedAt;
  }

  /**
   * The condition a Moment must meet to count toward anybody else's significance.
   *
   * `moderation.md:729` requires a removal to reach "significance-derived
   * presentation", and this is where it does: a Moment Chronologity has stopped
   * distributing stops being evidence that a place or an Event mattered to
   * people, and so does everything by a suspended account.
   *
   * Applied only where Moments are counted *across* people. A Moment's own
   * assessment still runs while it is moderated — computing it costs nothing
   * and reversing an appeal should not leave a stale score behind — and the
   * author's own earliest and latest Moments still bound their own record,
   * because that is a fact about their history rather than a claim made to
   * anybody else.
   *
   * @param alias - The alias the Moment table is joined under.
   * @returns A SQL condition taking no parameters, so it composes into the
   *   positional queries around it without renumbering them.
   */
  private static distributable(alias: string): string {
    return `${alias}.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM moderation_states ms
         WHERE ms.subject_type = 'moment'
           AND ms.subject_id = ${alias}.moment_id
           AND ms.state IN ('removed', 'temporarily_unavailable')
      )
      AND NOT EXISTS (
        SELECT 1 FROM users sig_author
         WHERE sig_author.user_id = ${alias}.author_user_id
           AND sig_author.status = 'suspended'
      )`;
  }

  /**
   * Find Moments whose significance is most out of date.
   *
   * Stalest first, claimed with `FOR UPDATE SKIP LOCKED` so several workers take
   * disjoint work — the same mechanism the outbox publisher uses. A Moment never
   * assessed has no rows at all, so it is found by absence rather than by age.
   *
   * @param limit - How many to take.
   * @returns Their identifiers, oldest assessment first.
   */
  async claimStalest(limit: number): Promise<string[]> {
    const rows: { moment_id: string }[] = await this.dataSource.query(
      `SELECT m.moment_id
         FROM moments m
         LEFT JOIN LATERAL (
           SELECT MIN(s.computed_at) AS computed_at
             FROM moment_significance s
            WHERE s.moment_id = m.moment_id
         ) assessed ON true
        WHERE m.deleted_at IS NULL
        ORDER BY assessed.computed_at ASC NULLS FIRST, m.moment_id
        LIMIT $1`,
      [limit],
    );

    return rows.map((row) => row.moment_id);
  }

  /**
   * Gather everything one Moment's significance is computed from.
   *
   * One query per question rather than one enormous join: each answers something
   * a different dimension needs, and a reader should be able to see which is
   * which.
   *
   * @param momentId - Which Moment.
   * @returns Its inputs, or undefined when there is no such Moment.
   */
  async inputsFor(momentId: string): Promise<SignificanceInputs | undefined> {
    const moment: { author_user_id: string; occurrence_start: Date }[] =
      await this.dataSource.query(
        `SELECT author_user_id, occurrence_start FROM moments
          WHERE moment_id = $1 AND deleted_at IS NULL`,
        [momentId],
      );
    const found = moment[0];

    if (found === undefined) {
      return undefined;
    }

    const causal = await this.causalFacts(momentId);
    const [structural, temporal, contexts] = [
      await this.structuralFacts(momentId, causal),
      await this.temporalFacts(momentId, found.author_user_id),
      await this.contextsFor(momentId),
    ];

    return {
      momentId,
      authorUserId: found.author_user_id,
      causal,
      structural,
      temporal,
      collective: await this.collectiveFacts(contexts),
      event: await this.eventFacts(contexts.eventIds),
      evidentiary: await this.evidentiaryFacts(momentId),
      markedBy: await this.markedBy(momentId),
      eventIds: contexts.eventIds,
      locationIds: contexts.locationIds,
    };
  }

  /**
   * Count everything reachable downstream of a Moment.
   *
   * A recursive walk rather than a count of direct edges, because invariant 7
   * forbids reducing causal significance to out-degree: in a chain, the first
   * Moment has one outgoing edge and the whole chain descends from it.
   *
   * Bounded in depth. An unbounded walk over a graph people can extend is a
   * query with no worst case, and the difference between six generations of
   * consequence and sixty is not one this dimension needs to express.
   *
   * @param momentId - Which Moment.
   * @returns How much descends from it, and how much it descends from.
   */
  private async causalFacts(momentId: string): Promise<CausalFacts> {
    const descendants: { count: string }[] = await this.dataSource.query(
      `WITH RECURSIVE reachable(moment_id, depth) AS (
         SELECT target_moment_id, 1
           FROM moment_relationships
          WHERE source_moment_id = $1 AND kind IN ('led_to', 'contributed_to')
         UNION
         SELECT r.target_moment_id, reachable.depth + 1
           FROM moment_relationships r
           JOIN reachable ON r.source_moment_id = reachable.moment_id
          WHERE r.kind IN ('led_to', 'contributed_to') AND reachable.depth < 6
       )
       SELECT COUNT(DISTINCT moment_id)::int AS count FROM reachable`,
      [momentId],
    );

    const ancestors: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM moment_relationships
        WHERE target_moment_id = $1 AND kind IN ('led_to', 'contributed_to')`,
      [momentId],
    );

    return {
      descendantCount: Number(descendants[0]?.count ?? 0),
      ancestorCount: Number(ancestors[0]?.count ?? 0),
    };
  }

  /**
   * Read a Moment's position in the wider shape of history.
   *
   * @param momentId - Which Moment.
   * @param causal - Already read, so the ancestor count is not asked for twice.
   * @returns Its edges and how many contexts it touches.
   */
  private async structuralFacts(momentId: string, causal: CausalFacts): Promise<StructuralFacts> {
    const outgoing: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM moment_relationships
        WHERE source_moment_id = $1 AND kind IN ('led_to', 'contributed_to')`,
      [momentId],
    );
    const contexts = await this.contextsFor(momentId);

    return {
      incomingEdges: causal.ancestorCount,
      outgoingEdges: Number(outgoing[0]?.count ?? 0),
      contextCount: contexts.eventIds.length + contexts.locationIds.length,
    };
  }

  /**
   * Decide which stretches of history a Moment bounds.
   *
   * Inferred from position: the earliest or latest its author has recorded, the
   * earliest or latest at its place, the earliest or latest among those tied to
   * one of its Events. Deterministic, and it invents nothing — a gap-based rule
   * would need a threshold nobody could justify.
   *
   * @param momentId - Which Moment.
   * @param authorUserId - Whose record it belongs to.
   * @returns Which boundaries it forms.
   */
  private async temporalFacts(momentId: string, authorUserId: string): Promise<TemporalFacts> {
    const bounds = async (sql: string, parameters: unknown[]): Promise<boolean> => {
      const rows: { bounds: boolean }[] = await this.dataSource.query(sql, parameters);

      return rows[0]?.bounds ?? false;
    };

    return {
      boundsRecord: await bounds(
        `SELECT (
           $1 IN (
             SELECT moment_id FROM moments
              WHERE author_user_id = $2 AND deleted_at IS NULL
              ORDER BY occurrence_start ASC, moment_id ASC LIMIT 1
           )
           OR $1 IN (
             SELECT moment_id FROM moments
              WHERE author_user_id = $2 AND deleted_at IS NULL
              ORDER BY occurrence_start DESC, moment_id DESC LIMIT 1
           )
         ) AS bounds`,
        [momentId, authorUserId],
      ),
      boundsPlace: await bounds(
        `SELECT EXISTS (
           SELECT 1 FROM moment_locations mine
            WHERE mine.moment_id = $1
              AND $1 IN (
                SELECT ml.moment_id FROM moment_locations ml
                  JOIN moments m ON m.moment_id = ml.moment_id AND ${MomentSignificanceRepository.distributable("m")}
                 WHERE ml.location_id = mine.location_id
                 ORDER BY m.occurrence_start ASC, m.moment_id ASC LIMIT 1
              )
         ) AS bounds`,
        [momentId],
      ),
      boundsEvent: await bounds(
        `SELECT EXISTS (
           SELECT 1 FROM moment_real_world_events mine
            WHERE mine.moment_id = $1
              AND $1 IN (
                SELECT mre.moment_id FROM moment_real_world_events mre
                  JOIN moments m ON m.moment_id = mre.moment_id AND ${MomentSignificanceRepository.distributable("m")}
                 WHERE mre.real_world_event_id = mine.real_world_event_id
                 ORDER BY m.occurrence_start ASC, m.moment_id ASC LIMIT 1
              )
         ) AS bounds`,
        [momentId],
      ),
    };
  }

  /**
   * Read the Events and places a Moment belongs to.
   *
   * @param momentId - Which Moment.
   * @returns Their identifiers. Each is a scope significance is computed in.
   */
  private async contextsFor(
    momentId: string,
  ): Promise<{ eventIds: string[]; locationIds: string[] }> {
    const events: { real_world_event_id: string }[] = await this.dataSource.query(
      `SELECT real_world_event_id FROM moment_real_world_events WHERE moment_id = $1`,
      [momentId],
    );
    const locations: { location_id: string }[] = await this.dataSource.query(
      `SELECT location_id FROM moment_locations WHERE moment_id = $1`,
      [momentId],
    );

    return {
      eventIds: events.map((row) => row.real_world_event_id),
      locationIds: locations.map((row) => row.location_id),
    };
  }

  /**
   * Count how many separate people converge on the same history.
   *
   * Distinct authors, never Moment volume: invariant 13 forbids the latter and
   * invariant 14 says independent convergence means more than duplicated or
   * coordinated volume. One person recording forty times is one perspective.
   *
   * @param contexts - The Events and places to look across.
   * @returns The largest number of separate people sharing any one of them.
   */
  private async collectiveFacts(contexts: {
    eventIds: string[];
    locationIds: string[];
  }): Promise<CollectiveFacts> {
    let distinctAuthors = 0;

    for (const eventId of contexts.eventIds) {
      const rows: { count: string }[] = await this.dataSource.query(
        `SELECT COUNT(DISTINCT m.author_user_id)::int AS count
           FROM moment_real_world_events mre
           JOIN moments m ON m.moment_id = mre.moment_id AND ${MomentSignificanceRepository.distributable("m")}
          WHERE mre.real_world_event_id = $1`,
        [eventId],
      );

      distinctAuthors = Math.max(distinctAuthors, Number(rows[0]?.count ?? 0));
    }

    for (const locationId of contexts.locationIds) {
      const rows: { count: string }[] = await this.dataSource.query(
        `SELECT COUNT(DISTINCT m.author_user_id)::int AS count
           FROM moment_locations ml
           JOIN moments m ON m.moment_id = ml.moment_id AND ${MomentSignificanceRepository.distributable("m")}
          WHERE ml.location_id = $1`,
        [locationId],
      );

      distinctAuthors = Math.max(distinctAuthors, Number(rows[0]?.count ?? 0));
    }

    return { distinctAuthors };
  }

  /**
   * Read a Moment's position among those tied to one Event.
   *
   * @param eventIds - The Events it belongs to.
   * @returns How much company it has. The Event with the fewest Moments is used,
   *   because being the only record of one occurrence is what the dimension
   *   measures — belonging additionally to a crowded Event does not diminish it.
   */
  private async eventFacts(eventIds: readonly string[]): Promise<EventFacts> {
    let fewest = 0;

    for (const eventId of eventIds) {
      const rows: { count: string }[] = await this.dataSource.query(
        `SELECT COUNT(*)::int AS count
           FROM moment_real_world_events mre
           JOIN moments m ON m.moment_id = mre.moment_id AND ${MomentSignificanceRepository.distributable("m")}
          WHERE mre.real_world_event_id = $1`,
        [eventId],
      );
      const count = Number(rows[0]?.count ?? 0);

      fewest = fewest === 0 ? count : Math.min(fewest, count);
    }

    return { momentsInEvent: fewest, isOnlyRecord: fewest === 1 };
  }

  /**
   * Count what other accounts say about the same occurrence.
   *
   * `alternate_perspective` is corroboration — another account of substantially
   * the same occurrence — and `contradicts` is dispute. Both are symmetric, so
   * each is counted from whichever end this Moment sits at.
   *
   * @param momentId - Which Moment.
   * @returns Corroborating and contradicting accounts.
   */
  private async evidentiaryFacts(momentId: string): Promise<EvidentiaryFacts> {
    const counted: { kind: string; count: string }[] = await this.dataSource.query(
      `SELECT kind, COUNT(*)::int AS count
         FROM moment_relationships
        WHERE (source_moment_id = $1 OR target_moment_id = $1)
          AND kind IN ('alternate_perspective', 'contradicts')
        GROUP BY kind`,
      [momentId],
    );
    const byKind = new Map(counted.map((row) => [row.kind, Number(row.count)]));

    return {
      corroborations: byKind.get("alternate_perspective") ?? 0,
      contradictions: byKind.get("contradicts") ?? 0,
    };
  }

  /**
   * Read who has marked a Moment as mattering to them.
   *
   * Used only to write each mark into that person's own scope. Nothing exposes
   * this list, and no endpoint reads it.
   *
   * @param momentId - Which Moment.
   * @returns Their identifiers.
   */
  private async markedBy(momentId: string): Promise<string[]> {
    const rows = await this.dataSource
      .getRepository(MomentPersonalSignificance)
      .find({ where: { momentId }, select: { userId: true } });

    return rows.map((row) => row.userId);
  }

  /**
   * Read what a Moment scored the first time each dimension was assessed.
   *
   * @param momentId - Which Moment.
   * @returns Baselines by a `scope|dimension` key, so a recomputation can keep
   *   them rather than overwrite what makes retrospective significance visible.
   */
  async baselinesFor(momentId: string): Promise<Map<string, number>> {
    const rows = await this.dataSource
      .getRepository(MomentSignificance)
      .find({ where: { momentId } });

    return new Map(
      rows.map((row) => [`${row.scopeType}|${row.scopeId}|${row.dimension}`, row.baselineValue]),
    );
  }

  /**
   * Replace everything known about one Moment's significance.
   *
   * Deleting and rewriting rather than merging, so a dimension that no longer
   * applies — a place removed, an Event dissociated — leaves no stale row
   * behind. Baselines are carried across by the caller.
   *
   * @param tx - The caller's transaction.
   * @param momentId - Which Moment.
   * @param scored - Everything it now scores, with baselines already resolved.
   * @param algorithmVersion - What computed it.
   * @param at - When.
   * @returns Nothing.
   */
  async replace(
    tx: Transaction,
    momentId: string,
    scored: readonly (ScoredSignificance & { baselineValue: number })[],
    algorithmVersion: string,
    at: Date,
  ): Promise<void> {
    await tx.delete(MomentSignificance, { momentId });

    if (scored.length === 0) {
      return;
    }

    await tx.insert(
      MomentSignificance,
      scored.map((row) => ({
        momentId,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        dimension: row.dimension,
        value: row.value,
        baselineValue: row.baselineValue,
        provenance: row.provenance,
        algorithmVersion,
        computedAt: at,
      })),
    );
  }
}
