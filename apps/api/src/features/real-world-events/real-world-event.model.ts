import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { Location } from "../locations/location.model.js";
import { User } from "../users/user.model.js";

/**
 * The real-world Event tables.
 *
 * A real-world Event is an occurrence in the world — a convention, a wedding,
 * an election — that gives several people's Moments a common context. It is
 * not a software event: `auth_audit_events` and the outbox use that word for
 * something else, which is why the full term is spelled out throughout
 * (`docs/glossary.md`).
 *
 * These describe tables the migrations own (ADR-099). The DataSource runs with
 * `synchronize` off, so nothing here alters a column.
 */

/**
 * An occurrence in the world.
 *
 * Identity lives in `realWorldEventId` and nowhere else. Two Events with the
 * same name are not the same Event — every night of a tour is called the same
 * thing and each is its own occurrence (`real-world-events.md:99-121`).
 */
@Entity("real_world_events")
@Index("real_world_events_occurrence_idx", ["occurrenceStart", "occurrenceEnd"])
@Index("real_world_events_created_by_idx", ["createdByUserId", "createdAt"])
export class RealWorldEvent {
  @PrimaryColumn("uuid", { name: "real_world_event_id" })
  realWorldEventId!: string;

  /**
   * Who first recorded it here.
   *
   * Provenance, never ownership. Recording the first entry for a public
   * occurrence confers no authority over anyone else's history of it
   * (`real-world-events.md:549-563`).
   */
  @Column("uuid", { name: "created_by_user_id" })
  createdByUserId!: string;

  /**
   * The name it was recorded under. Not unique, and not identity: duplicates
   * are expected before reconciliation exists, and refusing them would refuse
   * real history.
   */
  @Column("text")
  name!: string;

  /**
   * When it happened, as an interval at the precision it is actually known at.
   *
   * The interval is what carries approximation: "sometime in 1969" is the whole
   * of 1969 at `year` precision. Nothing invents a clock time nobody knows.
   */
  @Column("timestamptz", { name: "occurrence_start" })
  occurrenceStart!: Date;

  @Column("timestamptz", { name: "occurrence_end" })
  occurrenceEnd!: Date;

  /** `instant`, `day`, `month`, or `year`. Constrained by the database. */
  @Column("text", { name: "occurrence_precision" })
  occurrencePrecision!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "created_by_user_id" })
  createdBy?: User;

  @OneToMany(() => RealWorldEventAlias, (alias) => alias.event)
  aliases?: RealWorldEventAlias[];

  @OneToMany(() => RealWorldEventLocation, (place) => place.event)
  locations?: RealWorldEventLocation[];
}

/**
 * Another name the same occurrence goes by.
 *
 * A local name, a former name, an official name nobody uses. None is more the
 * Event's identity than another, and none is identity at all.
 */
@Entity("real_world_event_aliases")
export class RealWorldEventAlias {
  @PrimaryColumn("uuid", { name: "real_world_event_id" })
  realWorldEventId!: string;

  @PrimaryColumn("text")
  alias!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => RealWorldEvent, (event) => event.aliases)
  @JoinColumn({ name: "real_world_event_id" })
  event?: RealWorldEvent;
}

/**
 * A place an Event happened.
 *
 * Many rather than one: a marathon is a route, a product launch happens in
 * three cities at once (`real-world-events.md:211-247`). Unordered, because
 * ordering would describe a route and how routes are represented is still an
 * open product question.
 */
@Entity("real_world_event_locations")
export class RealWorldEventLocation {
  @PrimaryColumn("uuid", { name: "real_world_event_id" })
  realWorldEventId!: string;

  @PrimaryColumn("uuid", { name: "location_id" })
  locationId!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => RealWorldEvent, (event) => event.locations)
  @JoinColumn({ name: "real_world_event_id" })
  event?: RealWorldEvent;

  @ManyToOne(() => Location)
  @JoinColumn({ name: "location_id" })
  location?: Location;
}
