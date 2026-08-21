import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/**
 * The platform tables: the outbox, projection checkpoints, and applied
 * migrations.
 *
 * Not a feature. These belong to the machinery every feature runs on, which is
 * why they sit under `lib/database/` rather than in a feature directory.
 */

/**
 * An integration event waiting to reach Kafka.
 *
 * Written in the same transaction as the change it describes, so either both
 * land or neither does (ADR-016, ADR-093). Publication is deliberately
 * asynchronous: a writer that waited for the broker would be back to coupling
 * the two systems it just decoupled.
 */
@Entity("outbox_messages")
export class OutboxMessage {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("text")
  topic!: string;

  /** Determines ordering. Events that must stay ordered share a key. */
  @Column("text", { name: "partition_key" })
  partitionKey!: string;

  @Column("text", { name: "event_type" })
  eventType!: string;

  @Column("int", { name: "event_version" })
  eventVersion!: number;

  /**
   * Declared as `object` rather than a narrower shape: the driver serialises
   * whatever it is given, and an open index signature does not satisfy the
   * query builder's deep-partial of the column type. What a payload contains is
   * the publishing feature's concern, not this table's.
   */
  @Column("jsonb")
  payload!: object;

  @Column("jsonb")
  metadata!: object;

  @Column("text", { name: "aggregate_type" })
  aggregateType!: string;

  /**
   * Polymorphic — it names whatever kind `aggregateType` says, so it is not a
   * reference to any one table and carries no foreign key.
   */
  @Column("uuid", { name: "aggregate_id" })
  aggregateId!: string;

  /** Zero where the entity carries no version. */
  @Column("int", { name: "aggregate_version" })
  aggregateVersion!: number;

  @Index()
  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  /**
   * Null while pending. Claimed with `FOR UPDATE SKIP LOCKED`, which is what
   * keeps two publishers from sending the same message.
   */
  @Column("timestamptz", { name: "published_at", nullable: true })
  publishedAt!: Date | null;

  @Column("int", { default: 0 })
  attempts!: number;

  @Column("text", { name: "last_error", nullable: true })
  lastError!: string | null;
}

/**
 * What a projection has already handled.
 *
 * Keyed on the projection and the message, so a consumer handed the same
 * message twice does the work once. Replay depends on this.
 */
@Entity("projection_processed_events")
export class ProjectionProcessedEvent {
  @PrimaryColumn("text", { name: "projection_name" })
  projectionName!: string;

  /** Identifies a message rather than a row in any table. */
  @PrimaryColumn("uuid", { name: "event_id" })
  eventId!: string;

  @Column("timestamptz", { name: "processed_at" })
  processedAt!: Date;
}

/**
 * A migration that has been applied.
 *
 * Written by the runner in `migrations.ts`, which is the only thing that
 * changes this database. The DataSource runs with `synchronize` off and never
 * generates or applies a migration (ADR-099).
 */
@Entity("schema_migrations")
export class SchemaMigration {
  /** The migration's timestamp prefix. */
  @PrimaryColumn("text")
  version!: string;

  @Column("timestamptz", { name: "applied_at" })
  appliedAt!: Date;
}
