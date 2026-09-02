import type { DataSource } from "typeorm";
import { withTransaction, type Transaction } from "../../lib/database/transaction.js";
import { ProjectionProcessedEvent } from "../../lib/database/outbox.model.js";
import {
  buildLocationDocument,
  buildMomentDocument,
  buildRealWorldEventDocument,
  buildUserDocument,
  INDEX_VERSION,
  type SearchDocumentFields,
  type SearchEntityType,
} from "./search-document.js";
import type { SearchRepository } from "./search.repository.js";
import type { SearchSourceRepository } from "./search-source.repository.js";

/** What the projection is called in `projection_processed_events`. */
export const PROJECTION_NAME = "search-indexer";

/**
 * Keeping the Search index current.
 *
 * The seam between "something changed" and "what the document should now say".
 * Both drivers use it: the Kafka worker calls `index` when a message arrives,
 * and the rebuild calls it for every entity in turn. One builder, two drivers,
 * which is what makes a rebuild worth trusting — a second implementation would
 * only prove the two agreed on the day somebody last compared them.
 *
 * Every path here is idempotent. Indexing the same entity twice produces one
 * document, and indexing it after it has gone removes the document rather than
 * failing.
 */
export class SearchIndexer {
  /**
   * Build the indexer.
   *
   * @param dataSource - Opens the transaction a document and its
   *   processed-event record commit in.
   * @param documents - Where documents are written.
   * @param sources - Where authoritative state is read.
   * @param indexVersion - Which index to write. Injected so a rebuild can
   *   populate a new version while the current one keeps serving.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly documents: SearchRepository,
    private readonly sources: SearchSourceRepository,
    private readonly indexVersion: string = INDEX_VERSION,
  ) {}

  /**
   * Bring one entity's document up to date with authoritative state.
   *
   * Reads before it writes, and the reading's instant is what the regression
   * guard compares — not the write's. A slow write holding an old reading must
   * not overwrite a newer document, which is reachable whenever a rebuild runs
   * beside the worker.
   *
   * @param entityType - What kind of thing changed.
   * @param entityId - Which one.
   * @param sourceEventId - The message that prompted this, or undefined for a
   *   rebuild, which an operator caused rather than an event.
   * @returns What happened, so a caller can report it and a test can assert it.
   */
  async index(
    entityType: SearchEntityType,
    entityId: string,
    sourceEventId?: string,
  ): Promise<"written" | "removed" | "superseded"> {
    const builtAt = new Date();
    const fields = await this.build(entityType, entityId);

    return withTransaction(this.dataSource, async (tx) => {
      if (fields === undefined) {
        // The entity is gone, moderation removed it, or its eligibility cannot
        // be determined. All three mean the same thing here: exclusion rather
        // than retention (`search.md:295`).
        await this.documents.remove(tx, this.indexVersion, entityType, entityId);

        return "removed";
      }

      const written = await this.documents.upsert(
        tx,
        this.indexVersion,
        fields,
        builtAt,
        sourceEventId,
      );

      return written ? "written" : "superseded";
    });
  }

  /**
   * Bring a page of entities up to date in one transaction.
   *
   * The rebuild's path. One transaction per page rather than per entity,
   * because a full rebuild is tens of thousands of entities and a transaction
   * each turns an operational tool into one nobody will wait for — the same
   * mistake the significance worker made and had to have extracted out of it.
   *
   * @param entityType - What kind of thing.
   * @param entityIds - Which ones, in order.
   * @returns What happened to each, tallied.
   */
  async indexBatch(
    entityType: SearchEntityType,
    entityIds: readonly string[],
  ): Promise<{ written: number; removed: number; superseded: number }> {
    const builtAt = new Date();
    const built: { entityId: string; fields: SearchDocumentFields | undefined }[] = [];

    // Read one at a time. `Promise.all` over the page was the first version and
    // it exhausted the connection pool on the first batch: five hundred reads
    // asking for a connection at once against a pool of ten, every one of them
    // waiting for a connection none of them would release. Batching the writes
    // is what made the rebuild fast; fanning out the reads only made it fail.
    for (const entityId of entityIds) {
      built.push({ entityId, fields: await this.build(entityType, entityId) });
    }

    const tally = { written: 0, removed: 0, superseded: 0 };

    await withTransaction(this.dataSource, async (tx) => {
      for (const one of built) {
        if (one.fields === undefined) {
          await this.documents.remove(tx, this.indexVersion, entityType, one.entityId);
          tally.removed += 1;
          continue;
        }

        const written = await this.documents.upsert(
          tx,
          this.indexVersion,
          one.fields,
          builtAt,
          undefined,
        );

        if (written) {
          tally.written += 1;
        } else {
          tally.superseded += 1;
        }
      }
    });

    return tally;
  }

  /**
   * Handle one message, exactly once.
   *
   * The document write and the record that this message was handled commit
   * together, so a crash between them re-processes rather than skips. That is
   * what `projection_processed_events` has been waiting for since the
   * foundation migration — it was kept when event sourcing was dropped because
   * recognising work already done belongs to at-least-once delivery rather than
   * to any particular transport.
   *
   * @param eventId - The message's identifier.
   * @param entityType - What it says changed.
   * @param entityId - Which one.
   * @returns Whether this message was handled now. False means it had already
   *   been handled, which is the ordinary consequence of redelivery and not a
   *   failure.
   */
  async handle(
    eventId: string,
    entityType: SearchEntityType,
    entityId: string,
  ): Promise<boolean> {
    if (await this.alreadyHandled(eventId)) {
      return false;
    }

    await this.index(entityType, entityId, eventId);

    // Recorded after the document, so a crash in between redelivers and
    // re-indexes. Re-indexing is harmless; skipping is not.
    return withTransaction(this.dataSource, async (tx) => {
      await this.markHandled(tx, eventId);

      return true;
    });
  }

  /**
   * Whether a message has already been handled.
   *
   * @param eventId - The message's identifier.
   * @returns Whether it is recorded as processed.
   */
  private async alreadyHandled(eventId: string): Promise<boolean> {
    const rows: { count: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM projection_processed_events
        WHERE projection_name = $1 AND event_id = $2`,
      [PROJECTION_NAME, eventId],
    );

    return (rows[0]?.count ?? 0) > 0;
  }

  /**
   * Record that a message has been handled.
   *
   * @param tx - The caller's transaction.
   * @param eventId - The message's identifier.
   * @returns Nothing. A duplicate is ignored rather than raised: two deliveries
   *   racing is exactly what this table exists to absorb.
   */
  private async markHandled(tx: Transaction, eventId: string): Promise<void> {
    await tx
      .createQueryBuilder()
      .insert()
      .into(ProjectionProcessedEvent)
      .values({ projectionName: PROJECTION_NAME, eventId, processedAt: new Date() })
      .orIgnore()
      .execute();
  }

  /**
   * Build the document for one entity from authoritative state.
   *
   * @param entityType - What kind of thing.
   * @param entityId - Which one.
   * @returns The document, or undefined when there should not be one.
   */
  private async build(
    entityType: SearchEntityType,
    entityId: string,
  ): Promise<SearchDocumentFields | undefined> {
    switch (entityType) {
      case "moment": {
        const source = await this.sources.momentFor(entityId);

        return source === undefined ? undefined : buildMomentDocument(source);
      }
      case "user": {
        const source = await this.sources.userFor(entityId);

        return source === undefined ? undefined : buildUserDocument(source);
      }
      case "event": {
        const source = await this.sources.realWorldEventFor(entityId);

        return source === undefined ? undefined : buildRealWorldEventDocument(source);
      }
      case "location": {
        const source = await this.sources.locationFor(entityId);

        return source === undefined ? undefined : buildLocationDocument(source);
      }
      default:
        // An entity type nobody recognises indexes nothing. The alternative is
        // a widened vocabulary silently writing documents no query understands.
        return undefined;
    }
  }
}
