import type { DerivativeKind, MediaKind, Upload, UploadState } from "@chronologity/contracts";
import type { UploadRecord, UploadStatus } from "./upload.types.js";
import type pg from "pg";
import type { Transaction } from "../../lib/database/transaction.js";

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

interface UploadRow {
  upload_id: string;
  kind: string;
  state: string;
  declared_content_type: string;
  declared_byte_size: string;
  byte_size: string | null;
  content_type: string | null;
  checksum: string | null;
  failure_reason: string | null;
  media_kind: string | null;
  derivatives: string[] | null;
  width: number | null;
  height: number | null;
  duration_seconds: string | null;
  registered_at: Date;
  expires_at: Date;
  received_at: Date | null;
}

/**
 * Shape a row into the boundary contract.
 *
 * @param row - As read from `uploads`.
 * @returns The Upload as its owner sees it. Neither the storage key nor any
 *   URL is included: the key is infrastructure, and a durable signed URL is
 *   exactly what must not be stored or returned (`media.md:520`).
 */
function toUpload(row: UploadRow): Upload {
  return {
    uploadId: row.upload_id,
    kind: row.kind as MediaKind,
    state: row.state as UploadState,
    declaredContentType: row.declared_content_type,
    // bigint arrives as a string, since it can exceed what a number holds
    // exactly. File sizes never will, so converting here is safe.
    declaredByteSize: Number(row.declared_byte_size),
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    contentType: row.content_type,
    checksum: row.checksum,
    failureReason: row.failure_reason,
    mediaKind: row.media_kind === null ? null : (row.media_kind as MediaKind),
    derivatives: (row.derivatives ?? []) as DerivativeKind[],
    width: row.width,
    height: row.height,
    // numeric arrives as a string, since it can hold more precision than a
    // number. Durations never will, so converting here is safe.
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    registeredAt: row.registered_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    receivedAt: row.received_at?.toISOString() ?? null,
  };
}

const COLUMNS = `upload_id, kind, state, declared_content_type, declared_byte_size,
                 byte_size, content_type, checksum, failure_reason,
                 media_kind, derivatives, width, height, duration_seconds,
                 registered_at, expires_at, received_at`;

/** Reads and writes uploads. */
export class UploadRepository {
  /**
   * Build the Upload repository.
   *
   * @param pool - Used for reads. Writes take a transaction, so a state change
   *   and the message announcing it cannot commit separately.
   */
  constructor(private readonly pool: pg.Pool) {}

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
    const { rows } = await this.pool.query<{
      upload_id: string;
      owner_user_id: string;
      kind: string;
      storage_key: string;
      derivatives: string[] | null;
      state: string;
      expires_at: Date;
    }>(
      `SELECT upload_id, owner_user_id, kind, storage_key, derivatives, state, expires_at
         FROM uploads WHERE upload_id = $1`,
      [uploadId],
    );

    const row = rows[0];

    if (row === undefined) {
      return undefined;
    }

    return {
      uploadId: row.upload_id,
      ownerUserId: row.owner_user_id,
      kind: row.kind as MediaKind,
      storageKey: row.storage_key,
      derivatives: (row.derivatives ?? []) as DerivativeKind[],
      status: row.state as UploadStatus,
      expiresAt: row.expires_at,
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
    await tx.query(
      `INSERT INTO uploads
         (upload_id, owner_user_id, kind, state, declared_content_type, declared_byte_size,
          storage_key, registered_at, expires_at)
       VALUES ($1, $2, $3, 'registered', $4, $5, $6, $7, $8)`,
      [
        input.uploadId,
        input.ownerUserId,
        input.kind,
        input.declaredContentType,
        input.declaredByteSize,
        input.storageKey,
        input.registeredAt.toISOString(),
        input.expiresAt.toISOString(),
      ],
    );
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
    const { rowCount } = await tx.query(
      `UPDATE uploads
          SET state = 'received', byte_size = $2, content_type = $3, checksum = $4,
              received_at = $5, updated_at = now()
        WHERE upload_id = $1 AND state = 'registered'`,
      [
        input.uploadId,
        input.byteSize,
        input.contentType ?? null,
        input.checksum ?? null,
        input.receivedAt.toISOString(),
      ],
    );

    return rowCount === 1;
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
    const { rowCount } = await tx.query(
      `UPDATE uploads
          SET state = 'ready', media_kind = $2, codec = $3, container = $4,
              width = $5, height = $6, duration_seconds = $7, has_audio = $8,
              derivatives = $9, derived_at = $10, checked_at = $10,
              failure_reason = NULL, failure_category = NULL, updated_at = now()
        WHERE upload_id = $1 AND state = 'received'`,
      [
        input.uploadId,
        input.kind,
        input.codec,
        input.container,
        input.width,
        input.height,
        input.durationSeconds ?? null,
        input.hasAudio,
        input.derivatives,
        input.checkedAt.toISOString(),
      ],
    );

    return rowCount === 1;
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
    const { rowCount } = await tx.query(
      `UPDATE uploads
          SET state = 'failed', failure_reason = $2, failure_category = $3, updated_at = now()
        WHERE upload_id = $1 AND state NOT IN ('failed', 'deleted')`,
      [uploadId, reason, category],
    );

    return rowCount === 1;
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
    const { rowCount } = await tx.query(
      `UPDATE uploads SET state = 'deleted', updated_at = now()
        WHERE upload_id = $1 AND owner_user_id = $2 AND state <> 'deleted'`,
      [uploadId, ownerUserId],
    );

    return rowCount === 1;
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
    const { rows } = await tx.query<{ attempts: number }>(
      `UPDATE uploads SET attempts = attempts + 1, last_attempt_at = $2, updated_at = now()
        WHERE upload_id = $1
        RETURNING attempts`,
      [uploadId, at.toISOString()],
    );

    return rows[0]?.attempts ?? 0;
  }

  /**
   * Read one upload as its owner sees it.
   *
   * @param uploadId - Which upload.
   * @returns The Upload, or undefined if there is no such row.
   */
  async findById(uploadId: string): Promise<Upload | undefined> {
    const { rows } = await this.pool.query<UploadRow>(
      `SELECT ${COLUMNS} FROM uploads WHERE upload_id = $1`,
      [uploadId],
    );

    const row = rows[0];

    return row === undefined ? undefined : toUpload(row);
  }

  /**
   * List somebody's uploads, most recent first.
   *
   * @param ownerUserId - Whose uploads.
   * @param limit - How many at most.
   * @returns Their uploads. Deleted ones are excluded: their owner asked for
   *   them to be gone.
   */
  async findForOwner(ownerUserId: string, limit: number): Promise<Upload[]> {
    const { rows } = await this.pool.query<UploadRow>(
      `SELECT ${COLUMNS} FROM uploads
        WHERE owner_user_id = $1 AND state <> 'deleted'
        ORDER BY registered_at DESC
        LIMIT $2`,
      [ownerUserId, limit],
    );

    return rows.map(toUpload);
  }
}
