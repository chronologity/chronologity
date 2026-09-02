import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "../users/user.model.js";

/**
 * A place, as it was understood when somebody recorded it.
 *
 * `40.7505, -73.9934` is a measurement; "Madison Square Garden" is a place, and
 * the same ground holds different places over time. Nothing rewrites a row
 * after it is recorded — the map service will rename that venue eventually, and
 * this keeps what it was called when someone was there.
 *
 * Shared reference data. `recordedByUserId` is provenance, not ownership, and
 * confers nothing: two people choosing the same search result reach one record
 * (ADR-098).
 *
 * Two check constraints live in the migration and cannot be expressed here: a
 * known position must carry coordinates, an unknown one must not, and `source`
 * must be one the application recognises.
 */
@Entity("locations")
@Index("locations_recorded_by_idx", ["recordedByUserId", "createdAt"])
export class Location {
  @PrimaryColumn("uuid", { name: "location_id" })
  locationId!: string;

  /** Who first caused the record to exist. */
  @Column("uuid", { name: "recorded_by_user_id" })
  recordedByUserId!: string;

  /** As the place was named when recorded, not as the map service names it now. */
  @Column("text")
  name!: string;

  @Column("double precision", { nullable: true })
  latitude!: number | null;

  @Column("double precision", { nullable: true })
  longitude!: number | null;

  /** How precisely the position is known. */
  @Column("text")
  precision!: string;

  /**
   * Whether the place was searched for, read out of a photograph, or typed in.
   * Not all sources carry the same authority (`locations.md:333`).
   */
  @Column("text")
  source!: string;

  @Column("text", { nullable: true })
  neighbourhood!: string | null;

  @Column("text", { nullable: true })
  city!: string | null;

  @Column("text", { nullable: true })
  region!: string | null;

  @Column("text", { nullable: true })
  country!: string | null;

  @Column("char", { name: "country_code", length: 2, nullable: true })
  countryCode!: string | null;

  /**
   * The map service's own reference, as `type:id`. A partial unique index in
   * the migration makes it unique where present, which is what makes two people
   * choosing the same result reach one place.
   */
  @Column("text", { name: "source_reference", nullable: true })
  sourceReference!: string | null;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @Column("timestamptz", { name: "updated_at" })
  updatedAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "recorded_by_user_id" })
  recordedBy?: User;
}
