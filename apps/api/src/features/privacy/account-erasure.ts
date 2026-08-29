/**
 * What an account owns, and what becomes of it.
 *
 * A table rather than a procedure, for a reason that outlasts this sub-phase.
 * Thirty-nine foreign keys point at `users`, and the number only grows. Written
 * as code, erasing an account would be a long function whose omissions are
 * invisible — a table nobody remembered is a table that keeps somebody's data
 * after they asked for it to go, and nothing would say so.
 *
 * Written as data, the list can be checked against the database itself. The
 * integration suite reads `pg_constraint`, finds every reference into `users`
 * that would block or outlive a deletion, and asserts that each one is either
 * swept here or named in `DELIBERATELY_KEPT` with a reason. Adding a table that
 * points at `users` therefore fails the suite until somebody decides which it
 * is, which is the only way a list like this stays true.
 */

/** What happens to rows an account owns. */
export type SweepAction =
  /** The rows go. */
  | "delete"
  /** The rows stay and the reference to the account is erased. */
  | "clear";

/** One sweep. */
export interface AccountSweep {
  readonly table: string;
  readonly column: string;
  readonly action: SweepAction;
}

/**
 * Everything erasing an account touches, in the order it must happen.
 *
 * Children before parents throughout. Most of these would cascade from the row
 * above them, but an account is tombstoned rather than deleted, so no cascade
 * ever fires — every row has to be named. That is the cost of keeping the row,
 * and it is paid here where it can be seen and checked rather than discovered
 * later as data that quietly survived.
 */
export const ACCOUNT_SWEEPS: readonly AccountSweep[] = [
  // Things they left on other people's content. Their own content is erased
  // through the Moment path, which takes what sits under it.
  { table: "comment_reactions", column: "user_id", action: "delete" },
  { table: "comment_mentions", column: "user_id", action: "delete" },
  { table: "moment_comments", column: "author_user_id", action: "delete" },
  { table: "moment_reactions", column: "user_id", action: "delete" },
  { table: "moment_personal_significance", column: "user_id", action: "delete" },
  { table: "moment_relationships", column: "asserted_by_user_id", action: "delete" },
  { table: "moment_edits", column: "edited_by_user_id", action: "delete" },

  // Being named in somebody else's audience is a fact about them, not about
  // the Moment's author, so it goes with them.
  { table: "moment_audience", column: "user_id", action: "delete" },

  // Being named as having been part of somebody's Moment is a fact about them,
  // so it goes with them — including proposals nobody ever answered, which this
  // takes because it names no status. Nothing is left in place of one: a marker
  // saying somebody unnamed was here is a record of the association, which is
  // the thing erasure removes.
  //
  // The Moment stays. It is other people's history and was never this person's
  // to delete, the same rule comments and reactions get above.
  { table: "moment_participations", column: "user_id", action: "delete" },

  // Both directions, exactly as `user_blocks` above: there is no longer
  // anybody to be protected from or protected against.
  { table: "participation_refusals", column: "refusing_user_id", action: "delete" },
  { table: "participation_refusals", column: "refused_user_id", action: "delete" },

  // The social graph, in both directions. A block is severed too: there is no
  // longer anybody to be protected from or protected against.
  { table: "user_follows", column: "follower_user_id", action: "delete" },
  { table: "user_follows", column: "followed_user_id", action: "delete" },
  { table: "follow_requests", column: "requester_user_id", action: "delete" },
  { table: "follow_requests", column: "requested_user_id", action: "delete" },
  { table: "user_blocks", column: "blocker_user_id", action: "delete" },
  { table: "user_blocks", column: "blocked_user_id", action: "delete" },
  { table: "location_follows", column: "follower_user_id", action: "delete" },
  { table: "real_world_event_follows", column: "follower_user_id", action: "delete" },

  // Notifications, and everything beneath them. `notification_actors` is swept
  // by actor as well, because being named as somebody who reacted is a record
  // of them on a stranger's notification.
  { table: "notification_actors", column: "actor_user_id", action: "delete" },
  { table: "notification_deliveries", column: "recipient_user_id", action: "delete" },
  { table: "notification_source_events", column: "recipient_user_id", action: "delete" },
  { table: "notifications", column: "recipient_user_id", action: "delete" },
  { table: "notification_devices", column: "user_id", action: "delete" },
  { table: "notification_delivery_settings", column: "user_id", action: "delete" },
  { table: "notification_preferences", column: "user_id", action: "delete" },

  // Moderation about them. Appeals and decisions concern the departed account
  // and nobody else, so they go.
  { table: "moderation_appeals", column: "appellant_user_id", action: "delete" },
  { table: "moderation_actions", column: "affected_user_id", action: "delete" },

  // Moderation *by* them. The record stays and the person does not: a decision
  // still has to be answerable for even when the moderator has left, and an
  // appeal against one whose history vanished is not an appeal.
  { table: "moderation_states", column: "decided_by_user_id", action: "clear" },
  { table: "moderation_appeals", column: "decided_by_user_id", action: "clear" },
  { table: "moderation_actions", column: "actor_user_id", action: "clear" },

  // Reports they filed about other people. The report is evidence about
  // somebody who was never party to this deletion, and letting a reported
  // person destroy the complaints against them by leaving is a hole.
  { table: "moderation_reports", column: "reporter_user_id", action: "clear" },
  { table: "accuracy_reports", column: "reporter_user_id", action: "clear" },

  // Privileges, and who granted them to others.
  { table: "authorization_user_roles", column: "user_id", action: "delete" },
  { table: "authorization_user_roles", column: "assigned_by", action: "clear" },

  // Any export it prepared. A copy of somebody's whole history must not outlive
  // the account it belongs to, and the objects behind these rows are removed
  // before the rows go — a row deleted first would leave a copy in storage that
  // nothing would ever come back for.
  { table: "export_requests", column: "user_id", action: "delete" },

  // The account's own records. The date of birth has its own table precisely so
  // that erasing it is one targeted delete rather than a column update.
  { table: "user_restricted_data", column: "user_id", action: "delete" },
  { table: "user_preferences", column: "user_id", action: "delete" },
];

/** Why a table that references an account is not swept. */
export interface KeptTable {
  readonly table: string;
  readonly column: string;
  readonly because: string;
}

/**
 * References into `users` that erasure deliberately leaves alone.
 *
 * Every entry is a decision somebody made rather than a table somebody missed,
 * which is the whole point of writing them down beside the sweeps. The
 * integration suite treats this list and `ACCOUNT_SWEEPS` together as the
 * complete answer to "what points at an account", and fails if the database
 * knows of a reference neither mentions.
 */
export const DELIBERATELY_KEPT: readonly KeptTable[] = [
  {
    table: "locations",
    column: "recorded_by_user_id",
    because:
      "A Location is shared reference data. Other people's Moments name the place, and erasing it because the person who first recorded it left would delete history belonging to everybody else.",
  },
  {
    table: "real_world_events",
    column: "created_by_user_id",
    because:
      "A real-world Event is shared history for the same reason. Somebody who first recorded a concert did not thereby own it.",
  },
  {
    table: "moments",
    column: "author_user_id",
    because:
      "Erased through the Moment path rather than swept here, so that each one goes with its media, its comments, and its Search document exactly as a Moment deleted on its own would.",
  },
  {
    table: "uploads",
    column: "owner_user_id",
    because:
      "Erased through the upload path, which sweeps the object prefix so derived copies go too. A row deleted here would leave the bytes behind.",
  },
  {
    table: "user_handles",
    column: "user_id",
    because:
      "Released rather than deleted. The row is what holds the cooldown, and the cooldown is what stops an onlooker taking a departed account's name the moment it frees.",
  },
];
