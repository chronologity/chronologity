import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { SearchDocument } from "./search.model.js";
import { lexicalVector, shouldReplace, type SearchDocumentFields } from "./search-document.js";

/**
 * Reads and writes Search documents.
 *
 * Every write is an upsert keyed on `(index_version, entity_type, entity_id)`,
 * so indexing the same thing twice produces one document rather than two — the
 * property that makes at-least-once delivery survivable.
 */
export class SearchRepository {
  /**
   * Build the Search repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction, so a document
   *   and the record of the message that produced it commit together.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Write a document, unless a newer one is already there.
   *
   * The lexical vector is computed by the database from the parameters this
   * builds, because `to_tsvector` is the only thing that agrees with the
   * operators the query path will use. Building it in TypeScript would be a
   * second tokenizer, differing from the real one in exactly the cases that
   * matter.
   *
   * @param tx - The caller's transaction.
   * @param indexVersion - Which index this belongs to.
   * @param fields - The document, as a builder produced it.
   * @param builtAt - When authoritative state was read. The regression guard
   *   compares against this, not against now.
   * @param sourceEventId - Which message produced it, or undefined for a
   *   rebuild, which is caused by an operator rather than by an event.
   * @returns Whether a document was written. False means a newer one already
   *   stood, which happens whenever a rebuild runs beside the indexer.
   */
  async upsert(
    tx: Transaction,
    indexVersion: string,
    fields: SearchDocumentFields,
    builtAt: Date,
    sourceEventId: string | undefined,
  ): Promise<boolean> {
    const stored: { built_at: Date }[] = await tx.query(
      `SELECT built_at FROM search_documents
        WHERE index_version = $1 AND entity_type = $2 AND entity_id = $3`,
      [indexVersion, fields.entityType, fields.entityId],
    );

    if (!shouldReplace(stored[0]?.built_at, builtAt)) {
      return false;
    }

    // The vector reads the same parameters the columns do, so there is one
    // place a title can be passed and no interleaving to get wrong. Written out
    // rather than built by the query builder because a tsvector expression
    // needs a raw fragment either way.
    await tx.query(
      `INSERT INTO search_documents (
         index_version, entity_type, entity_id,
         title, body, aliases, search_vector,
         occurrence_start, occurrence_end, occurrence_precision, published_at,
         visibility, searchable, moderation_state, deleted, discoverable, author_user_id,
         geohash_exact, geohash_coarse, geohash_region,
         significance, significance_version, provenance,
         built_at, source_event_id, indexed_at
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6, ${lexicalVector(4, 6, 5)},
         $7, $8, $9, $10,
         $11, $12, $13, $14, $24, $15,
         $16, $17, $18,
         $19, $20, $21,
         $22, $23, now()
       )
       ON CONFLICT (index_version, entity_type, entity_id) DO UPDATE SET
         title = EXCLUDED.title,
         body = EXCLUDED.body,
         aliases = EXCLUDED.aliases,
         search_vector = EXCLUDED.search_vector,
         occurrence_start = EXCLUDED.occurrence_start,
         occurrence_end = EXCLUDED.occurrence_end,
         occurrence_precision = EXCLUDED.occurrence_precision,
         published_at = EXCLUDED.published_at,
         visibility = EXCLUDED.visibility,
         searchable = EXCLUDED.searchable,
         moderation_state = EXCLUDED.moderation_state,
         deleted = EXCLUDED.deleted,
         discoverable = EXCLUDED.discoverable,
         author_user_id = EXCLUDED.author_user_id,
         geohash_exact = EXCLUDED.geohash_exact,
         geohash_coarse = EXCLUDED.geohash_coarse,
         geohash_region = EXCLUDED.geohash_region,
         significance = EXCLUDED.significance,
         significance_version = EXCLUDED.significance_version,
         provenance = EXCLUDED.provenance,
         built_at = EXCLUDED.built_at,
         source_event_id = EXCLUDED.source_event_id,
         indexed_at = now()`,
      [
        indexVersion,
        fields.entityType,
        fields.entityId,
        fields.title,
        fields.body,
        fields.aliases,
        fields.occurrenceStart,
        fields.occurrenceEnd,
        fields.occurrencePrecision,
        fields.publishedAt,
        fields.visibility,
        fields.searchable,
        fields.moderationState,
        fields.deleted,
        fields.authorUserId,
        fields.geohashExact,
        fields.geohashCoarse,
        fields.geohashRegion,
        fields.significance,
        fields.significanceVersion,
        JSON.stringify(fields.provenance),
        builtAt,
        sourceEventId ?? null,
        fields.discoverable,
      ],
    );

    return true;
  }

  /**
   * Remove a document.
   *
   * Used when the entity is gone, when moderation removed it, and when
   * eligibility cannot be determined at all. `search.md:295` requires exclusion
   * rather than retention in that last case: a document nobody can decide about
   * is a document that should not be found.
   *
   * @param tx - The caller's transaction.
   * @param indexVersion - Which index.
   * @param entityType - What kind of thing.
   * @param entityId - Which one.
   * @returns Nothing. Removing what is not there is success: the desired state
   *   is that it is absent.
   */
  async remove(
    tx: Transaction,
    indexVersion: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    await tx.delete(SearchDocument, { indexVersion, entityType, entityId });
  }

  /**
   * One document, for tests and for comparing index versions.
   *
   * @param indexVersion - Which index.
   * @param entityType - What kind of thing.
   * @param entityId - Which one.
   * @returns The document, or undefined when there is none.
   */
  async find(
    indexVersion: string,
    entityType: string,
    entityId: string,
  ): Promise<SearchDocument | undefined> {
    return (
      (await this.dataSource
        .getRepository(SearchDocument)
        .findOne({ where: { indexVersion, entityType, entityId } })) ?? undefined
    );
  }

  /**
   * How many documents an index version holds.
   *
   * @param indexVersion - Which index.
   * @returns The count. Used to compare a rebuild against what it replaced.
   */
  async count(indexVersion: string): Promise<number> {
    return this.dataSource.getRepository(SearchDocument).countBy({ indexVersion });
  }
}
