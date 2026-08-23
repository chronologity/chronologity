import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
} from "typeorm";
import { Location } from "../locations/location.model.js";
import { RealWorldEvent } from "../real-world-events/real-world-event.model.js";
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
   * Who recorded it.
   *
   * Authorship alone. Who may see it is `visibility`, and the two stopped
   * coinciding when Moments gained an audience.
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

  /**
   * Who may see it: `private`, `restricted`, or `public`.
   *
   * Public unless its author said otherwise (ADR-108). The column default says
   * so, and the constraint the migrations own is what keeps the three values
   * honest.
   */
  @Column("text", { default: "public" })
  visibility!: string;

  /**
   * How much of this Moment's place other people are told.
   *
   * Not the same as the Location's own `precision`. That says how well anybody
   * knows where this happened and is a fact about history; this says how much
   * of it a Viewer receives and is the author's privacy choice
   * (`locations.md:830`). The author always receives the exact place.
   */
  @Column("text", { name: "location_disclosure", default: "exact" })
  locationDisclosure!: string;

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

  @OneToOne(() => MomentLocation, (place) => place.moment)
  place?: MomentLocation;

  @OneToMany(() => MomentRealWorldEvent, (association) => association.moment)
  realWorldEvents?: MomentRealWorldEvent[];
}

/**
 * A change somebody made to a Moment.
 *
 * `moments.md:534` asks that corrections be represented explicitly. Editing is
 * permitted — historical integrity does not mean absolute technical
 * immutability — but a Moment that quietly moved through history, or quietly
 * lost a photograph, would leave nothing to trust.
 *
 * Every kind of edit is kept, not only the ones that move a Moment in time.
 */
@Entity("moment_edits")
@Index("moment_edits_moment_idx", ["momentId", "editedAt"])
export class MomentEdit {
  @PrimaryColumn("uuid", { name: "edit_id" })
  editId!: string;

  @Column("uuid", { name: "moment_id" })
  momentId!: string;

  /**
   * Who made the change. Always the Moment's author today, recorded anyway
   * because that stops being obvious the moment anybody else can.
   */
  @Column("uuid", { name: "edited_by_user_id" })
  editedByUserId!: string;

  /**
   * What kind of change it was — recorded rather than inferred, because the
   * product distinguishes moving a Moment in time from correcting its caption.
   */
  @Column("text")
  kind!: string;

  /**
   * What the changed thing was before, shaped to the kind.
   *
   * Declared as `object` for the reason the audit tables' `context` is: the
   * driver serialises whatever it is given, and an open index signature does
   * not satisfy the query builder's deep-partial of the column type.
   */
  @Column("jsonb")
  previous!: object;

  @Column("timestamptz", { name: "edited_at" })
  editedAt!: Date;

  @ManyToOne(() => Moment)
  @JoinColumn({ name: "moment_id" })
  moment?: Moment;
}

/**
 * Where a Moment's experience happened.
 *
 * One per Moment, which the primary key enforces. `locations.md:433` asks that
 * the Moment-level Location represent the experience as a whole; media pointing
 * at several distinct places usually means several Moments rather than one
 * Moment in several places.
 *
 * A row rather than a column on the Moment, because an association is an
 * assertion carrying its own provenance.
 */
@Entity("moment_locations")
export class MomentLocation {
  @PrimaryColumn("uuid", { name: "moment_id" })
  momentId!: string;

  @Column("uuid", { name: "location_id" })
  locationId!: string;

  /**
   * How the association came to be. `user-asserted` is the only value anything
   * can currently produce; suggestion, inference, and import are named by the
   * specifications and arrive with the capabilities that make them.
   */
  @Column("text")
  origin!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @OneToOne(() => Moment, (moment) => moment.place)
  @JoinColumn({ name: "moment_id" })
  moment?: Moment;

  @ManyToOne(() => Location)
  @JoinColumn({ name: "location_id" })
  location?: Location;
}

/**
 * A larger occurrence a Moment was part of.
 *
 * Several are permitted: a photograph at a wedding that is also part of a family
 * reunion is genuinely both. The asymmetry with Locations is deliberate — an
 * Event is a shared occurrence that may span places, a Moment is one person's
 * experience of somewhere.
 */
@Entity("moment_real_world_events")
export class MomentRealWorldEvent {
  @PrimaryColumn("uuid", { name: "moment_id" })
  momentId!: string;

  @PrimaryColumn("uuid", { name: "real_world_event_id" })
  realWorldEventId!: string;

  /** As on `MomentLocation`: one producible value, widened by capability. */
  @Column("text")
  origin!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => Moment, (moment) => moment.realWorldEvents)
  @JoinColumn({ name: "moment_id" })
  moment?: Moment;

  @ManyToOne(() => RealWorldEvent)
  @JoinColumn({ name: "real_world_event_id" })
  realWorldEvent?: RealWorldEvent;
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
