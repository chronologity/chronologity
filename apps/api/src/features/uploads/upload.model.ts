import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "../users/user.model.js";

/**
 * A file on its way in.
 *
 * `state` is what every transition is guarded against, and each transition is a
 * conditional update naming the state it expects to move from. That is what
 * makes the lifecycle safe under at-least-once delivery: two checkers handed
 * the same file both believe it is theirs to finish, and only the one whose
 * condition still matched actually changed anything.
 *
 * What the uploader declared is kept alongside what was actually measured:
 * `declaredContentType` and `kind` are claims, `contentType` and `mediaKind`
 * are findings. Nothing a client says about a file is authoritative
 * (`media.md`).
 */
@Entity("uploads")
@Index("uploads_owner_idx", ["ownerUserId", "registeredAt"])
export class Upload {
  @PrimaryColumn("uuid", { name: "upload_id" })
  uploadId!: string;

  @Column("uuid", { name: "owner_user_id" })
  ownerUserId!: string;

  /** As declared at registration. */
  @Column("text")
  kind!: string;

  @Column("text", { name: "declared_content_type" })
  declaredContentType!: string;

  @Column("bigint", { name: "declared_byte_size" })
  declaredByteSize!: string;

  /** Server-generated. Never returned to a client, and never client-supplied. */
  @Column("text", { name: "storage_key", unique: true })
  storageKey!: string;

  /** `registered`, `received`, `ready`, `failed`, or `deleted`. */
  @Column("text", { default: "registered" })
  state!: string;

  /** What storage reported when the file arrived. */
  @Column("bigint", { name: "byte_size", nullable: true })
  byteSize!: string | null;

  @Column("text", { name: "content_type", nullable: true })
  contentType!: string | null;

  @Column("text", { nullable: true })
  checksum!: string | null;

  @Column("timestamptz", { name: "received_at", nullable: true })
  receivedAt!: Date | null;

  /** What opening the file established. Authoritative over anything declared. */
  @Column("text", { name: "media_kind", nullable: true })
  mediaKind!: string | null;

  @Column("text", { nullable: true })
  codec!: string | null;

  @Column("text", { nullable: true })
  container!: string | null;

  @Column("int", { nullable: true })
  width!: number | null;

  @Column("int", { nullable: true })
  height!: number | null;

  /** Enforced server-side against the 90-second limit. */
  @Column("numeric", { name: "duration_seconds", precision: 10, scale: 3, nullable: true })
  durationSeconds!: string | null;

  @Column("boolean", { name: "has_audio", nullable: true })
  hasAudio!: boolean | null;

  @Column("timestamptz", { name: "checked_at", nullable: true })
  checkedAt!: Date | null;

  @Column("text", { array: true, default: () => "'{}'" })
  derivatives!: string[];

  @Column("timestamptz", { name: "derived_at", nullable: true })
  derivedAt!: Date | null;

  @Column("text", { name: "failure_reason", nullable: true })
  failureReason!: string | null;

  /** `transient` or `permanent` — whether trying again could ever help. */
  @Column("text", { name: "failure_category", nullable: true })
  failureCategory!: string | null;

  /**
   * Counted before the work rather than after, so a checker that crashes
   * mid-decode still leaves evidence it tried. Otherwise a file that reliably
   * kills the decoder would be retried forever, each attempt leaving no trace.
   */
  @Column("int", { default: 0 })
  attempts!: number;

  @Column("timestamptz", { name: "registered_at" })
  registeredAt!: Date;

  @Column("timestamptz", { name: "expires_at" })
  expiresAt!: Date;

  @Column("timestamptz", { name: "last_attempt_at", nullable: true })
  lastAttemptAt!: Date | null;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "owner_user_id" })
  owner?: User;
}
