import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/**
 * The record of an export being prepared.
 *
 * The row describes where a copy of somebody's history is and when it stops
 * existing. It holds no history itself: the parts are in object storage and the
 * media is never copied at all.
 *
 * This describes a table the migrations own (ADR-099). The DataSource runs with
 * `synchronize` off, so nothing here alters a column.
 */
@Entity("export_requests")
@Index("export_requests_due_idx", ["dueAt", "requestId"], { where: "state = 'pending'" })
export class ExportRequest {
  @PrimaryColumn("uuid", { name: "request_id" })
  requestId!: string;

  @Column("uuid", { name: "user_id" })
  userId!: string;

  /** `pending`, `ready`, `failed`, `abandoned`, or `expired`. */
  @Column("text")
  state!: string;

  @Column("int")
  attempts!: number;

  /** When to try, and the lease while trying. */
  @Column("timestamptz", { name: "due_at" })
  dueAt!: Date;

  /** Where the parts were written. Null until the build succeeds. */
  @Column("text", { name: "storage_prefix", nullable: true })
  storagePrefix!: string | null;

  @Column("int", { name: "part_count", nullable: true })
  partCount!: number | null;

  /**
   * When this copy stops being available.
   *
   * The only thing standing between a prepared export and a permanent second
   * copy of somebody's entire history.
   */
  @Column("timestamptz", { name: "expires_at", nullable: true })
  expiresAt!: Date | null;

  @Column("text", { name: "error_category", nullable: true })
  errorCategory!: string | null;

  @Column("text", { name: "last_error", nullable: true })
  lastError!: string | null;

  @Column("timestamptz", { name: "requested_at" })
  requestedAt!: Date;

  @Column("timestamptz", { name: "completed_at", nullable: true })
  completedAt!: Date | null;
}
