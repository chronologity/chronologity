import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Location } from "../locations/location.model.js";
import { RealWorldEvent } from "../real-world-events/real-world-event.model.js";
import { User } from "../users/user.model.js";

/**
 * The following tables.
 *
 * Following is directional and needs no reciprocity. These describe the
 * relationship between *people*; following a historical context is a different
 * relationship with different rules, and would get its own tables.
 *
 * These describe tables the migrations own (ADR-099). The DataSource runs with
 * `synchronize` off, so nothing here alters a column.
 */

/**
 * One person following another.
 *
 * Its existence is the whole relationship. There is no state to move through:
 * a Follow either is or is not, and ending one removes the row rather than
 * marking it — the record that somebody once followed somebody else is not
 * something the product has asked to keep.
 */
@Entity("user_follows")
@Index("user_follows_followed_idx", ["followedUserId", "createdAt", "followerUserId"])
@Index("user_follows_follower_idx", ["followerUserId", "createdAt", "followedUserId"])
export class UserFollow {
  @PrimaryColumn("uuid", { name: "follower_user_id" })
  followerUserId!: string;

  @PrimaryColumn("uuid", { name: "followed_user_id" })
  followedUserId!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "follower_user_id" })
  follower?: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: "followed_user_id" })
  followed?: User;
}

/**
 * Somebody asking to follow an account that requires approval.
 *
 * A request is not a Follow (`social-graph.md:169`). Rows are never reused: a
 * second ask after a refusal is a second row, so what was asked and refused
 * survives. That is what makes a cooldown implementable later without one being
 * invented now — the specification requires the model support it and leaves the
 * policy to product design.
 *
 * A partial unique index allows only one pending request between two people.
 */
@Entity("follow_requests")
@Index("follow_requests_requested_idx", ["requestedUserId", "requestedAt"])
export class FollowRequest {
  @PrimaryColumn("uuid", { name: "request_id" })
  requestId!: string;

  @Column("uuid", { name: "requester_user_id" })
  requesterUserId!: string;

  @Column("uuid", { name: "requested_user_id" })
  requestedUserId!: string;

  /** `pending`, `accepted`, `declined`, or `cancelled`. */
  @Column("text")
  status!: string;

  @Column("timestamptz", { name: "requested_at" })
  requestedAt!: Date;

  /** Null while pending. */
  @Column("timestamptz", { name: "resolved_at", nullable: true })
  resolvedAt!: Date | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: "requester_user_id" })
  requester?: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: "requested_user_id" })
  requested?: User;
}

/**
 * Somebody following a real-world Event.
 *
 * What an interface may present as "follow this Timeline". A Timeline is
 * derived and has nothing to follow; what is followed is the context it is
 * derived from (`timelines.md`).
 *
 * No approval, unlike following a person: an Event is shared history whose
 * creator holds provenance rather than authority, so there is nobody to ask.
 */
@Entity("real_world_event_follows")
@Index("real_world_event_follows_follower_idx", [
  "followerUserId",
  "createdAt",
  "realWorldEventId",
])
export class RealWorldEventFollow {
  @PrimaryColumn("uuid", { name: "follower_user_id" })
  followerUserId!: string;

  @PrimaryColumn("uuid", { name: "real_world_event_id" })
  realWorldEventId!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "follower_user_id" })
  follower?: User;

  @ManyToOne(() => RealWorldEvent)
  @JoinColumn({ name: "real_world_event_id" })
  realWorldEvent?: RealWorldEvent;
}

/**
 * Somebody following a Location.
 *
 * The same idea in space: tell me what happens at this place. A Location is
 * shared reference data (ADR-098), so again there is nobody to ask.
 */
@Entity("location_follows")
@Index("location_follows_follower_idx", ["followerUserId", "createdAt", "locationId"])
export class LocationFollow {
  @PrimaryColumn("uuid", { name: "follower_user_id" })
  followerUserId!: string;

  @PrimaryColumn("uuid", { name: "location_id" })
  locationId!: string;

  @Column("timestamptz", { name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: "follower_user_id" })
  follower?: User;

  @ManyToOne(() => Location)
  @JoinColumn({ name: "location_id" })
  location?: Location;
}
