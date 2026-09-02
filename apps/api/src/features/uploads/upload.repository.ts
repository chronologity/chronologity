import type { Cursor } from "../../lib/pagination/cursor.js";
import type { DerivativeKind, MediaKind, Upload, UploadState } from "@chronologity/contracts";
import type { UploadRecord, UploadStatus } from "./upload.types.js";
import { In, Not, type DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { Upload as UploadRow } from "./upload.model.js";

/**
 * Where uploads are stored.
 *
 * PostgreSQL is the authority for an Upload (ADR-092): the row is the record
 * rather than a projection of one, and the `state` column is what a transition
 * is guarded against.
 *
 * Every transition is a conditional update naming the state it expects to move
 * from. That is what makes the lifecycle safe under at-least-once delivery: two
 * checkers handed the same file both believe it is theirs to finish, and only
 * the one whose `WHERE` clause still matched actually changed anything.
 */

/**
 * Shape a row into the boundary contract.
 *
 * Exported because Moments return their media whole rather than by identifier,
 * and the shape a caller receives should be decided in one place — here, by the
 * feature that owns the table.
 *
 * @param row - As read from `uploads`.
 * @returns The Upload as its owner sees it. Neither the storage key nor any
 *   URL is included: the key is infrastructure, and a durable signed URL is
 *   exactly what must not be stored or returned (`media.md:520`).
 */
export function toUpload(row: UploadRow): Upload {
  return {
    uploadId: row.uploadId,
    kind: row.kind as MediaKind,
    state: row.state as UploadState,
    declaredContentType: row.declaredContentType,
    // `bigint` and `numeric` columns arrive as strings, since either can hold
    // more than a number represents exactly. File sizes and durations never
    // will, so converting here is safe.
    declaredByteSize: Number(row.declaredByteSize),
    byteSize: row.byteSize === null ? null : Number(row.byteSize),
    contentType: row.contentType,
    checksum: row.checksum,
    failureReason: row.failureReason,
    mediaKind: row.mediaKind === null ? null : (row.mediaKind as MediaKind),
    derivatives: row.derivatives as DerivativeKind[],
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds === null ? null : Number(row.durationSeconds),
    registeredAt: row.registeredAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    receivedAt: row.receivedAt?.toISOString() ?? null,
  };
}

/** Reads and writes uploads. */
export class UploadRepository {
  /**
   * Build the Upload repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction, so a state
   *   change and the message announcing it cannot commit separately.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Read the stored state a transition is decided against.
   *
   * @param uploadId - Which upload.
   * @returns What the row holds, or undefined if there is no such upload. A
   *   deleted upload is returned rather than hidden: the caller decides what
   *   deletion means for the operation it is performing, and only the delete
   *   path treats it as success rather than absence.
   */
  async findRecord(uploadId: string): Promise<UploadRecord | undefined> {
    const row = await this.dataSource.getRepository(UploadRow).findOne({
      where: { uploadId },
      select: {
        uploadId: true,
        ownerUserId: true,
        kind: true,
        storageKey: true,
        derivatives: true,
        state: true,
        expiresAt: true,
      },
    });

    if (row === null) {
      return undefined;
    }

    return {
      uploadId: row.uploadId,
      ownerUserId: row.ownerUserId,
      kind: row.kind as MediaKind,
      storageKey: row.storageKey,
      derivatives: row.derivatives as DerivativeKind[],
      status: row.state as UploadStatus,
      expiresAt: row.expiresAt,
    };
  }

  /**
   * Record a registered upload.
   *
   * @param tx - The caller's transaction.
   * @param input - Everything established at registration.
   * @returns Nothing.
   */
  async insert(
    tx: Transaction,
    input: {
      uploadId: string;
      ownerUserId: string;
      kind: MediaKind;
      declaredContentType: string;
      declaredByteSize: number;
      storageKey: string;
      registeredAt: Date;
      expiresAt: Date;
    },
  ): Promise<void> {
    await tx.insert(UploadRow, {
      uploadId: input.uploadId,
      ownerUserId: input.ownerUserId,
      kind: input.kind,
      state: "registered",
      declaredContentType: input.declaredContentType,
      declaredByteSize: String(input.declaredByteSize),
      storageKey: input.storageKey,
      registeredAt: input.registeredAt,
      expiresAt: input.expiresAt,
      updatedAt: input.registeredAt,
    });
  }

  /**
   * Move an upload to `received`, recording what storage reported.
   *
   * @param tx - The caller's transaction.
   * @param input - What arrived, and when.
   * @returns True if this call moved it. False means it was not in
   *   `registered` — already received, already refused, or deleted — which a
   *   retried finalize reaches legitimately.
   */
  async markReceived(
    tx: Transaction,
    input: {
      uploadId: string;
      byteSize: number;
      contentType: string | undefined;
      checksum: string | undefined;
      receivedAt: Date;
    },
  ): Promise<boolean> {
    // The state it must move from is part of the condition rather than
    // something read first, which is what makes a retried finalize safe.
    const { affected } = await tx.update(
      UploadRow,
      { uploadId: input.uploadId, state: "registered" },
      {
        state: "received",
        byteSize: String(input.byteSize),
        contentType: input.contentType ?? null,
        checksum: input.checksum ?? null,
        receivedAt: input.receivedAt,
        updatedAt: new Date(),
      },
    );

    return affected === 1;
  }

  /**
   * Move an upload to `ready`, recording what opening the file established.
   *
   * @param tx - The caller's transaction.
   * @param input - What the decoder found, what was produced, and when.
   * @returns True if this call moved it. False means another checker got there
   *   first, which at-least-once delivery makes ordinary rather than
   *   exceptional.
   */
  async markReady(
    tx: Transaction,
    input: {
      uploadId: string;
      kind: MediaKind;
      codec: string;
      container: string;
      width: number;
      height: number;
      durationSeconds: number | undefined;
      hasAudio: boolean;
      derivatives: readonly DerivativeKind[];
      checkedAt: Date;
    },
  ): Promise<boolean> {
    // One statement rather than two, so history cannot show a checked upload
    // whose derivatives went missing between them. The measured kind is written
    // to `media_kind` rather than over `kind`, which keeps what the uploader
    // declared alongside what was actually found.
    const { affected } = await tx.update(
      UploadRow,
      { uploadId: input.uploadId, state: "received" },
      {
        state: "ready",
        mediaKind: input.kind,
        codec: input.codec,
        container: input.container,
        width: input.width,
        height: input.height,
        durationSeconds: input.durationSeconds === undefined ? null : String(input.durationSeconds),
        hasAudio: input.hasAudio,
        derivatives: [...input.derivatives],
        derivedAt: input.checkedAt,
        checkedAt: input.checkedAt,
        failureReason: null,
        failureCategory: null,
        updatedAt: new Date(),
      },
    );

    return affected === 1;
  }

  /**
   * Record a refused upload.
   *
   * @param tx - The caller's transaction.
   * @param uploadId - Which upload.
   * @param reason - Why, in terms safe to show the upload's owner.
   * @param category - Whether trying again could ever help. Permanent unless
   *   stated, because most refusals are statements about the file itself.
   * @returns True if this call refused it. False means it was already settled
   *   or deleted; the first answer stands, because a later refusal would
   *   overwrite the reason that actually ended it.
   */
  async markFailed(
    tx: Transaction,
    uploadId: string,
    reason: string,
    category: "transient" | "permanent" = "permanent",
  ): Promise<boolean> {
    const { affected } = await tx.update(
      UploadRow,
      { uploadId, state: Not(In(["failed", "deleted"])) },
      {
        state: "failed",
        failureReason: reason,
        failureCategory: category,
        updatedAt: new Date(),
      },
    );

    return affected === 1;
  }

  /**
   * Remove an upload.
   *
   * @param tx - The caller's transaction.
   * @param uploadId - Which upload.
   * @param ownerUserId - Who is deleting it. Part of the statement rather than
   *   a check before it, so a stranger's delete cannot succeed on a row that
   *   changed hands between the check and the write.
   * @returns True if this call removed it. False means it was already deleted,
   *   never existed, or belongs to somebody else — three answers the caller
   *   deliberately cannot tell apart.
   */
  async markDeleted(tx: Transaction, uploadId: string, ownerUserId: string): Promise<boolean> {
    const { affected } = await tx.update(
      UploadRow,
      { uploadId, ownerUserId, state: Not("deleted") },
      { state: "deleted", updatedAt: new Date() },
    );

    return affected === 1;
  }

  /**
   * Count an attempt at checking a file.
   *
   * Incremented before the work rather than after, so a checker that crashes
   * mid-decode still leaves evidence it tried. Otherwise a file that reliably
   * kills the decoder would be retried forever, each attempt leaving no trace.
   *
   * @param tx - The caller's transaction.
   * @param uploadId - Which upload.
   * @param at - When the attempt started.
   * @returns How many attempts have now been made, including this one.
   */
  async countAttempt(tx: Transaction, uploadId: string, at: Date): Promise<number> {
    const counted = await tx
      .createQueryBuilder()
      .update(UploadRow)
      .set({ attempts: () => "attempts + 1", lastAttemptAt: at, updatedAt: new Date() })
      .where("upload_id = :uploadId", { uploadId })
      .returning(["attempts"])
      .execute();

    return (counted.raw as { attempts: number }[])[0]?.attempts ?? 0;
  }

  /**
   * Read one upload as its owner sees it.
   *
   * @param uploadId - Which upload.
   * @returns The Upload, or undefined if there is no such row.
   */
  async findById(uploadId: string): Promise<Upload | undefined> {
    const row = await this.dataSource.getRepository(UploadRow).findOneBy({ uploadId });

    return row === null ? undefined : toUpload(row);
  }

  /**
   * Read a page of somebody's uploads, most recent first.
   *
   * @param ownerUserId - Whose uploads.
   * @param limit - How many at most.
   * @param after - Where to continue from, or undefined for the first page.
   * @returns Their uploads, each with what the next cursor is built from.
   *   Deleted ones are excluded: their owner asked for them to be gone.
   */
  async findForOwner(
    ownerUserId: string,
    limit: number,
    after?: Cursor,
  ): Promise<{ upload: Upload; registeredAt: Date }[]> {
    const query = this.dataSource
      .getRepository(UploadRow)
      .createQueryBuilder("upload")
      .where("upload.owner_user_id = :ownerUserId", { ownerUserId })
      .andWhere("upload.state != 'deleted'")
      .orderBy("upload.registered_at", "DESC")
      .addOrderBy("upload.upload_id", "DESC")
      .take(limit);

    if (after !== undefined) {
      // The pair compared as a tuple, so an upload sharing a registration
      // moment with the last of the previous page is neither repeated nor
      // skipped.
      query.andWhere("(upload.registered_at, upload.upload_id) < (:at, :uploadId)", {
        at: after.at,
        uploadId: after.id,
      });
    }

    const rows = await query.getMany();

    return rows.map((row) => ({ upload: toUpload(row), registeredAt: row.registeredAt }));
  }
}
