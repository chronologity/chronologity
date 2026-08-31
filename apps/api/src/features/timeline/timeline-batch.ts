/**
 * Deciding what a batch of projections must clear out of its way.
 *
 * Pure, and separate from either store, so the decisions can be tested without
 * both — the arrangement `timeline-projection.ts` already uses for deciding what
 * belongs on the Timeline at all.
 *
 * **A `ReplacingMergeTree` collapses rows sharing a sort key, keeping the one
 * with the greater `projected_at`.** So rewriting a Moment needs no delete,
 * provided the new row lands on the same sort key as the old. A delete is
 * required exactly where it would not — where the stale row would sit beside the
 * new one rather than be collapsed into it.
 *
 * That distinction is worth the care. Deleting eagerly costs a ClickHouse
 * mutation per page, which is most of what makes a rebuild slow; deleting too
 * little shows a Moment twice, at two dates or at two places, permanently.
 */

/**
 * How many partitions ClickHouse will accept in a single insert.
 *
 * Its own `max_partitions_per_insert_block` default, restated because a batch
 * has to respect it and there is nothing to read it from at the point the split
 * is decided. Both projection tables partition by the year a Moment occurred in,
 * so this is a limit on how many distinct years one insert may span.
 *
 * Deliberately not raised on the insert instead. The limit exists to stop one
 * write creating hundreds of tiny parts, which is a real pathology; overriding a
 * server protection the application did not configure would silence a warning
 * that is telling the truth.
 */
export const MAXIMUM_PARTITIONS_PER_BLOCK = 100;

/** A row of `timeline_moments` as the batch probe reads it. */
export interface StoredMomentRow {
  readonly momentId: string;
  /**
   * Read as an integer rather than as a formatted timestamp.
   *
   * ClickHouse renders `DateTime64(3)` according to a server setting, so
   * comparing text would silently start reporting "changed" for everything if
   * that setting moved — safe, but it would quietly restore a mutation per page
   * and nothing would say so. Milliseconds are exact and negative for history
   * before 1970, which this projection is full of.
   */
  readonly occurredAtMs: number;
}

/** A row of `timeline_moment_contexts` as the batch probe reads it. */
export interface StoredContextRow {
  readonly momentId: string;
  readonly contextType: string;
  readonly contextId: string;
  readonly occurredAtMs: number;
}

/** What a Moment's context rows are about to become. */
export interface DesiredContexts {
  readonly occurredAtMs: number;
  readonly contexts: readonly { readonly type: string; readonly id: string }[];
}

/**
 * Which Moments need their stored row deleted before the new one is written.
 *
 * @param stored - What the projection holds for the Moments in this batch.
 * @param desired - Where each Moment is about to be written, by identifier.
 * @returns The Moments whose stored rows would otherwise survive alongside the
 *   new ones. A Moment stored where it is going needs nothing: the engine
 *   collapses the pair. A Moment stored anywhere else does, because occurrence
 *   leads the sort key and the table partitions by its year, so the stale row
 *   lands in a partition the new one will never merge with.
 */
export function momentsNeedingRoom(
  stored: readonly StoredMomentRow[],
  desired: ReadonlyMap<string, number>,
): Set<string> {
  const room = new Set<string>();

  for (const row of stored) {
    const going = desired.get(row.momentId);

    // Not being written by this batch. The probe reads by identifier so this
    // should not arise, but deleting a row nobody asked about is not a mistake
    // worth leaving available.
    if (going === undefined) {
      continue;
    }

    if (row.occurredAtMs !== going) {
      room.add(row.momentId);
    }
  }

  return room;
}

/**
 * Which Moments need their stored context rows deleted before the new ones.
 *
 * Wider than the rule for Moments, and this is the difference that matters: a
 * Moment's contexts can change without its occurrence changing at all. A
 * Location corrected, a real-world Event unlinked, a participation withdrawn —
 * each leaves a row whose `(context_type, context_id)` prefix the new write
 * never touches, so nothing collapses it.
 *
 * Gaining a context needs no room: the existing rows are all still wanted and
 * the new one lands on a sort key of its own.
 *
 * @param stored - What the projection holds for the Moments in this batch.
 * @param desired - What each Moment's contexts are about to become.
 * @returns The Moments with at least one stored row that is not about to be
 *   rewritten exactly as it stands.
 */
export function contextsNeedingRoom(
  stored: readonly StoredContextRow[],
  desired: ReadonlyMap<string, DesiredContexts>,
): Set<string> {
  const wanted = new Map<string, Set<string>>();

  for (const [momentId, going] of desired) {
    wanted.set(
      momentId,
      new Set(
        going.contexts.map((context) => `${context.type} ${context.id} ${going.occurredAtMs}`),
      ),
    );
  }

  const room = new Set<string>();

  for (const row of stored) {
    const going = wanted.get(row.momentId);

    if (going === undefined) {
      continue;
    }

    if (!going.has(`${row.contextType} ${row.contextId} ${row.occurredAtMs}`)) {
      room.add(row.momentId);
    }
  }

  return room;
}

/**
 * Split rows so no single insert spans more partitions than ClickHouse allows.
 *
 * Splitting on how many *years* a piece spans rather than on how many rows it
 * holds, because that is what the limit is about: two hundred rows from two
 * hundred years is refused, and ten thousand from one year is not.
 *
 * @param rows - What is to be written.
 * @param yearOf - Which partition a row belongs to. The tables partition by
 *   `toYear(occurred_at)`, and these columns are written as UTC wall-clock, so
 *   this is the row's UTC year and needs no round trip to work out.
 * @returns One or more pieces, together holding every row exactly once, each
 *   spanning at most the permitted number of years. Rows keep their order, so a
 *   page that arrived sorted by the table's sort key stays that way.
 */
export function byPartitionBudget<T>(rows: readonly T[], yearOf: (row: T) => number): T[][] {
  if (rows.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  let current: T[] = [];
  let years = new Set<number>();

  for (const row of rows) {
    const year = yearOf(row);

    if (!years.has(year) && years.size === MAXIMUM_PARTITIONS_PER_BLOCK) {
      chunks.push(current);
      current = [];
      years = new Set<number>();
    }

    years.add(year);
    current.push(row);
  }

  chunks.push(current);

  return chunks;
}
