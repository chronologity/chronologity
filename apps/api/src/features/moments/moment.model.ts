import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { Upload } from "../uploads/upload.model.js";
import { User } from "../users/user.model.js";

/**
 * The Moment tables.
 *
 * A Moment is something that happened, at a time, recorded by one person. Media
 * is evidence of the experience; the Moment is the experience
 * (`moments.md:54`).
 *
 * These describe tables the migrations own (ADR-099). The DataSource runs with
 * `synchronize` off, so nothing here alters a column.
 */

/** Something that happened. */
@Entity("moments")
@Index("moments_author_idx", ["authorUserId", "occurrenceStart", "momentId"])
export class Moment {
  @PrimaryColumn("uuid", { name: "moment_id" })
  momentId!: string;

  /**
   * Who recorded it — authorship, and for now also audience, since every
   * Moment is private to its author until the social graph exists.
   */
  @Column("uuid", { name: "author_user_id" })
  authorUserId!: string;

  /**
   * What happened, in words. Required: media and a timestamp alone are a
   * photograph with a date on it.
   */
  @Column("text")
  caption!: string;

  /**
   * When it happened, as an interval at the precision it is known at.
   *
   * This is historical position, not `createdAt`, and may precede it by
   * decades.
   */
  @Column("timestamptz", { name: "occurrence_start" })
  occurrenceStart!: Date;

  @Column("timestamptz", { name: "occurrence_end" })
  occurrenceEnd!: Date;

  /** `instant`, `day`, `month`, or `year`. Constrained by the database. */
  @Column("text", { name: "occurrence_precision" })
  occurrencePrecision!: string;

  /**
   * How far from UTC the person was, in minutes.
   *
   * The instant alone cannot say "half past seven in the evening", because a
   * `timestamptz` normalises the offset away.
   */
  @Column("int", { name: "occurrence_offset_minutes" })
  occurrenceOffsetMinutes!: number;

  /** `private` is the only value. Widened when audiences exist. */
  @Column("text", { default: "private" })
  visibility!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;

  /**
   * Set when a Moment is removed from ordinary access. Nothing writes it yet —
   * deletion is 5H-3, and the column exists now so that work is additive.
   */
  @Column("timestamptz", { name: "deleted_at", nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: "author_user_id" })
  author?: User;

  @OneToMany(() => MomentMedium, (medium) => medium.moment)
  media?: MomentMedium[];
}

/**
 * One piece of media representing a Moment, and where it sits in the order.
 *
 * Presentation order only: it says nothing about when anything happened, and
 * changing it never moves the Moment through chronology (`moments.md:143`).
 */
@Entity("moment_media")
export class MomentMedium {
  @PrimaryColumn("uuid", { name: "moment_id" })
  momentId!: string;

  @PrimaryColumn("uuid", { name: "upload_id" })
  uploadId!: string;

  /** Dense and zero-based, and unique within the Moment. */
  @Column("int")
  position!: number;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => Moment, (moment) => moment.media)
  @JoinColumn({ name: "moment_id" })
  moment?: Moment;

  @ManyToOne(() => Upload)
  @JoinColumn({ name: "upload_id" })
  upload?: Upload;
}
