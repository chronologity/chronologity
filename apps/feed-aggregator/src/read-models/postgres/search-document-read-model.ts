import type { Pool } from "pg";

/**
 * Asking whether a thing is still findable.
 *
 * **One boolean, and deliberately nothing else.** `architecture/search.md:65`
 * gives retrieval, ranking and suggestion to `apps/api`; this reads no title, no
 * body, no aliases and no `search_vector`, issues no `tsquery`, and cannot
 * return a document. It answers a yes-or-no question about an identifier the
 * caller already holds.
 *
 * **Only the intrinsic half of Search eligibility.** The index splits its rules
 * exactly where this application needs them split, and says so in the migration
 * that created it: "Intrinsic eligibility: what is true of the resource
 * regardless of who is asking. The viewer-dependent half — blocks, age, the
 * requesting surface — is resolved at query time and is deliberately absent."
 * The viewer-dependent half stays in the API, and this application answers its
 * own version of it by reauthorizing the destination against authoritative
 * tables. **Copying that predicate here is the mistake ADR-120 named** — "a
 * Discovery query with its own copy of the access rule… One predicate,
 * narrowed" — and the way to avoid it is to have no predicate about viewers at
 * all, which is why no method here takes one.
 *
 * **This is not an access boundary, and must not be read as one.** Every
 * destination reachable through a found reference is equally reachable through
 * the place, occasion or Moment anchor, which apply visibility and no
 * findability rule. What this earns is the right to say a landing came from a
 * search; it guards nothing that was not already guarded (ADR-148).
 */

/** The four things a Search document can be about (ADR-117). */
export type SearchEntityType = "moment" | "user" | "event" | "location";

/**
 * Reads one fact about the Search index, for every Viewer alike.
 */
export class SearchDocumentReadModel {
  /**
   * Build the read model.
   *
   * @param pool - The read-only connection this application holds.
   * @param indexVersion - Which index to ask about. Two versions coexist while a
   *   rebuild runs, so this names the one the API is serving rather than
   *   whichever row happens to exist.
   */
  constructor(
    private readonly pool: Pool,
    private readonly indexVersion: string,
  ) {}

  /**
   * Whether Search could still offer this thing to anybody at all.
   *
   * **Exactly the two conditions `apps/api` treats as intrinsic**, and no
   * others: a document that is not deleted and is marked searchable. Its
   * `moderation_state` is deliberately absent, because the states recorded there
   * are read against the person asking — an age-restricted thing is findable by
   * an adult, and one restricted to an audience is findable by that audience.
   * Testing it here would refuse for everybody what the API refuses only for
   * some, which is the copied-and-narrowed predicate this class exists not to
   * have. Those rules are answered instead where this application already
   * answers them, by reauthorizing the destination itself.
   *
   * A missing document and an unsearchable one are not distinguished, because
   * distinguishing them would say something exists.
   *
   * @param entityType - What kind of thing was found.
   * @param entityId - Which one. Compared against a `uuid` column, so a caller
   *   must have checked its shape.
   * @returns Whether a live, searchable document exists for it under the
   *   configured index version. False also when the version is one this process
   *   is not configured for, which is a misconfiguration answering as a refusal
   *   rather than as an error.
   * @throws {Error} If PostgreSQL refuses the statement.
   */
  async findable(entityType: SearchEntityType, entityId: string): Promise<boolean> {
    const result = await this.pool.query<{ findable: boolean }>(
      `SELECT true AS findable
         FROM search_documents
        WHERE index_version = $1
          AND entity_type = $2
          AND entity_id = $3
          AND NOT deleted
          AND searchable`,
      [this.indexVersion, entityType, entityId],
    );

    return result.rows.length > 0;
  }
}
