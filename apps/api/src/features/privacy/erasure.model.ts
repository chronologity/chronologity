import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/**
 * The record of erasure still owed.
 *
 * Note what is absent. There is no column for who asked. For a Moment the
 * author is the only person who can ask, and once the Moment is erased this row
 * would otherwise be the one remaining record that a particular person had
 * recorded something — which is exactly the trace erasure exists to remove.
 * What survives is an opaque identifier for something that no longer exists and
 * the fact that it was erased.
 *
 * These describe a table the migrations own (ADR-099). The DataSource runs with
 * `synchronize` off, so nothing here alters a column.
 */
@Entity("erasure_requests")
@Index("erasure_requests_due_idx", ["dueAt", "requestId"], { where: "state = 'pending'" })
export class ErasureRequest {
  @PrimaryColumn("uuid", { name: "request_id" })
  requestId!: string;

  /** `moment`. Constrained by the database, and widened when more can be erased. */
  @Column("text", { name: "subject_type" })
  subjectType!: string;

  @Column("uuid", { name: "subject_id" })
  subjectId!: string;

  /** `pending`, `completed`, `failed`, or `abandoned`. */
  @Column("text")
  state!: string;

  @Column("int")
  attempts!: number;

  /**
   * When to try, and the lease while trying.
   *
   * A worker claims a due request, pushes this forward, and commits before any
   * of the slow work — so a process that dies mid-erasure leaves a request that
   * becomes due again rather than one stuck in a state nobody clears.
   */
  @Column("timestamptz", { name: "due_at" })
  dueAt!: Date;

  /** `transient` is retried; `permanent` is not. */
  @Column("text", { name: "error_category", nullable: true })
  errorCategory!: string | null;

  @Column("text", { name: "last_error", nullable: true })
  lastError!: string | null;

  @Column("timestamptz", { name: "requested_at" })
  requestedAt!: Date;

  @Column("timestamptz", { name: "completed_at", nullable: true })
  completedAt!: Date | null;
}
