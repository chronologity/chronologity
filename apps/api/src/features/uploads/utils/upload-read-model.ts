import type { DerivativeKind, MediaKind, Upload, UploadState } from "@chronologity/contracts";
import type pg from "pg";
import type { Transaction } from "../../../lib/database/transaction.js";

/**
 * The Upload read model.
 *
 * Derived from Upload history and written in the same transaction as the
 * decision it reflects. The aggregate remains the authority; this is what the
 * product reads, and what carries the storage key that history also holds.
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

/**
 * Record a registered upload.
 *
 * @param tx - The caller's transaction.
 * @param input - Everything established at registration.
 * @returns Nothing.
 */
export async function recordUploadRegistered(
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
       (upload_id, owner_user_id, kind, declared_content_type, declared_byte_size,
        storage_key, state, registered_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'registered', $7, $8)`,
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
 * Record what storage reported for a received upload.
 *
 * @param tx - The caller's transaction.
 * @param input - The verified facts and when they were established.
 * @returns Nothing.
 */
export async function recordUploadReceived(
  tx: Transaction,
  input: {
    uploadId: string;
    byteSize: number;
    contentType: string | undefined;
    checksum: string | undefined;
    receivedAt: Date;
  },
): Promise<void> {
  await tx.query(
    `UPDATE uploads
        SET state = 'received', byte_size = $2, content_type = $3, checksum = $4,
            received_at = $5, updated_at = now()
      WHERE upload_id = $1`,
    [
      input.uploadId,
      input.byteSize,
      input.contentType ?? null,
      input.checksum ?? null,
      input.receivedAt.toISOString(),
    ],
  );
}

/**
 * Record what opening the file established.
 *
 * @param tx - The caller's transaction.
 * @param input - What the decoder found and when.
 * @returns Nothing. The measured kind is written to `media_kind` rather than
 *   over `kind`, which keeps what the uploader declared alongside what was
 *   actually found.
 */
export async function recordUploadChecked(
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
    checkedAt: Date;
  },
): Promise<void> {
  await tx.query(
    `UPDATE uploads
        SET state = 'ready', media_kind = $2, codec = $3, container = $4,
            width = $5, height = $6, duration_seconds = $7, has_audio = $8,
            checked_at = $9, failure_reason = NULL, failure_category = NULL,
            updated_at = now()
      WHERE upload_id = $1`,
    [
      input.uploadId,
      input.kind,
      input.codec,
      input.container,
      input.width,
      input.height,
      input.durationSeconds ?? null,
      input.hasAudio,
      input.checkedAt.toISOString(),
    ],
  );
}

/**
 * Record what was produced for showing this media.
 *
 * @param tx - The caller's transaction.
 * @param uploadId - Which upload.
 * @param derivatives - Everything that now exists, not only what was just made.
 * @param at - When they were produced.
 * @returns Nothing.
 */
export async function recordDerivatives(
  tx: Transaction,
  uploadId: string,
  derivatives: readonly DerivativeKind[],
  at: Date,
): Promise<void> {
  await tx.query(
    `UPDATE uploads SET derivatives = $2, derived_at = $3, updated_at = now()
      WHERE upload_id = $1`,
    [uploadId, derivatives, at.toISOString()],
  );
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
export async function countAttempt(tx: Transaction, uploadId: string, at: Date): Promise<number> {
  const { rows } = await tx.query<{ attempts: number }>(
    `UPDATE uploads SET attempts = attempts + 1, last_attempt_at = $2, updated_at = now()
      WHERE upload_id = $1
      RETURNING attempts`,
    [uploadId, at.toISOString()],
  );

  return rows[0]?.attempts ?? 0;
}

/**
 * Record a refused upload.
 *
 * @param tx - The caller's transaction.
 * @param uploadId - Which upload.
 * @param reason - Why, in terms safe to show its owner.
 * @param category - Whether trying again could ever help. Recorded so that a
 *   decision to stop retrying is auditable rather than re-derived.
 * @returns Nothing.
 */
export async function recordUploadFailed(
  tx: Transaction,
  uploadId: string,
  reason: string,
  category: "transient" | "permanent" = "permanent",
): Promise<void> {
  await tx.query(
    `UPDATE uploads
        SET state = 'failed', failure_reason = $2, failure_category = $3, updated_at = now()
      WHERE upload_id = $1`,
    [uploadId, reason, category],
  );
}

/**
 * Record a deleted upload.
 *
 * @param tx - The caller's transaction.
 * @param uploadId - Which upload.
 * @returns Nothing. The row is retained in a deleted state rather than removed,
 *   so that a request for it answers "gone" rather than "never existed" while
 *   erasure semantics are still to be defined in 5R.
 */
export async function recordUploadDeleted(tx: Transaction, uploadId: string): Promise<void> {
  await tx.query(`UPDATE uploads SET state = 'deleted', updated_at = now() WHERE upload_id = $1`, [
    uploadId,
  ]);
}

/**
 * Read where an upload's bytes live.
 *
 * @param pool - Read-only use.
 * @param uploadId - Which upload.
 * @returns The storage key, or undefined if there is no such upload. Read back
 *   rather than recomputed, so a change to key generation cannot orphan
 *   objects already stored.
 */
export async function readStorageKey(pool: pg.Pool, uploadId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ storage_key: string }>(
    `SELECT storage_key FROM uploads WHERE upload_id = $1`,
    [uploadId],
  );

  return rows[0]?.storage_key;
}

/**
 * Read one upload.
 *
 * @param pool - Read-only use.
 * @param uploadId - Which upload.
 * @returns The Upload, or undefined if there is no such row. Authorization is
 *   the caller's business: this answers what exists, not who may see it.
 */
export async function readUpload(pool: pg.Pool, uploadId: string): Promise<Upload | undefined> {
  const { rows } = await pool.query<UploadRow>(
    `SELECT ${COLUMNS} FROM uploads WHERE upload_id = $1`,
    [uploadId],
  );

  const row = rows[0];

  return row === undefined ? undefined : toUpload(row);
}

/**
 * Read someone's uploads.
 *
 * @param pool - Read-only use.
 * @param ownerUserId - Whose uploads.
 * @param limit - How many, newest first.
 * @returns Their uploads. Deleted ones are excluded: their owner asked for them
 *   to be gone, and listing them would contradict that.
 */
export async function readUploadsForUser(
  pool: pg.Pool,
  ownerUserId: string,
  limit = 50,
): Promise<Upload[]> {
  const { rows } = await pool.query<UploadRow>(
    `SELECT ${COLUMNS} FROM uploads
      WHERE owner_user_id = $1 AND state <> 'deleted'
      ORDER BY registered_at DESC
      LIMIT $2`,
    [ownerUserId, limit],
  );

  return rows.map(toUpload);
}
