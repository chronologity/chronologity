/**
 * What should stop existing, and when.
 *
 * The other kind of removal. 5R-1 to 5R-3 handled what somebody asks for — a
 * Moment deleted, an account deleted, a copy taken. This is the residue nobody
 * asks about: consumed sign-in links, spent phone codes, delivery records,
 * retired device tokens, audit events, and uploads registered and never
 * finished. `product/privacy.md:764` requires keeping personal information only
 * as long as it serves a purpose, and says plainly that different categories
 * need different periods.
 *
 * **The schedule is data rather than code**, for the reason `ACCOUNT_SWEEPS` is:
 * written as a long function, what expires and when would be readable only by
 * reading all of it, and an omission would be invisible. Written as a table, it
 * can be read in one sitting and checked by a test.
 *
 * **Nothing here touches history.** No Moment, comment, reaction, Location,
 * Event, or moderation record appears below, and a test asserts that by
 * counting them across a sweep of everything. A product built to preserve
 * decades does not expire the decades; what it expires is the exhaust.
 */

/** Which configured period governs a rule. */
export type RetentionPeriod =
  | "signInArtefacts"
  | "readNotifications"
  | "notifications"
  | "requiredNotifications"
  | "notificationDeduplication"
  | "deliveryRecords"
  | "dormantDevices"
  | "retiredDevices"
  | "auditEvents"
  | "privacyRequests";

/** How long each category is kept, in days. */
export type RetentionPeriods = Readonly<Record<RetentionPeriod, number>>;

/** One rule in the schedule. */
export interface RetentionRule {
  /** What this rule is called when it is reported. */
  readonly name: string;
  readonly table: string;
  /** The timestamp that decides whether a row is past its period. */
  readonly column: string;
  /**
   * Which rows this rule applies to, as a SQL predicate.
   *
   * Written here rather than assembled at the call site so that the whole rule
   * — what, by when, and which — reads in one place. These are constants in
   * this file and never come from a caller, which is what makes them safe to
   * interpolate.
   */
  readonly where: string;
  readonly period: RetentionPeriod;
  /**
   * What happens to the rows.
   *
   * `remove` deletes them. `retire` marks a device invalidated instead, because
   * a device that has gone quiet should stop being pushed at before its row
   * stops existing — the retired row is what distinguishes a dead token from
   * one that was never registered.
   */
  readonly action: "remove" | "retire";
}

/**
 * Everything that ages out, and on what schedule.
 *
 * Ordered so that anything cascading from something else comes after it, and
 * otherwise from shortest-lived to longest.
 */
export const RETENTION_SCHEDULE: readonly RetentionRule[] = [
  // Spent proofs. A consumed link is used and an expired one is dead; both are
  // kept briefly so that "this link was already used" can still be diagnosed,
  // and no longer, because a token row is a record of somebody signing in.
  {
    name: "consumed sign-in links",
    table: "magic_link_tokens",
    column: "created_at",
    where: "consumed_at IS NOT NULL OR expires_at < now()",
    period: "signInArtefacts",
    action: "remove",
  },
  {
    name: "spent phone codes",
    table: "phone_sign_in_codes",
    column: "created_at",
    where: "consumed_at IS NOT NULL OR expires_at < now()",
    period: "signInArtefacts",
    action: "remove",
  },

  // Notifications, by category and by whether they were dealt with. Read state
  // is the signal: an unread notification is something somebody has not seen,
  // and expiring it would remove a thing they were never told.
  {
    name: "read notifications",
    table: "notifications",
    column: "read_at",
    where: "category IN ('social', 'media') AND read_at IS NOT NULL",
    period: "readNotifications",
    action: "remove",
  },
  {
    name: "ordinary notifications",
    table: "notifications",
    column: "created_at",
    where: "category IN ('social', 'media')",
    period: "notifications",
    action: "remove",
  },
  // Longest of all. A moderation notification carries a right of appeal, and a
  // security one is the record that somebody was told their account changed.
  {
    name: "required notifications",
    table: "notifications",
    column: "created_at",
    where: "category IN ('moderation', 'security')",
    period: "requiredNotifications",
    action: "remove",
  },
  // Swept on its own, because nothing cascades to it. It references `users` and
  // not `notifications`, so every notification sweep leaves it untouched and it
  // would otherwise grow without limit. Its purpose is recognising a redelivered
  // message, which Kafka stops redelivering long before this period.
  {
    name: "notification deduplication",
    table: "notification_source_events",
    column: "handled_at",
    where: "true",
    period: "notificationDeduplication",
    action: "remove",
  },
  {
    name: "delivery records",
    table: "notification_deliveries",
    column: "completed_at",
    where: "status <> 'pending'",
    period: "deliveryRecords",
    action: "remove",
  },

  // A client re-registers on every launch, so silence is evidence that an
  // installation has gone. With no push provider to report rejections this is
  // the only such signal, and pushing at dead installations for ever is what
  // the token lifecycle exists to prevent.
  {
    name: "dormant devices",
    table: "notification_devices",
    column: "last_seen_at",
    where: "status = 'active'",
    period: "dormantDevices",
    action: "retire",
  },
  {
    name: "retired devices",
    table: "notification_devices",
    column: "invalidated_at",
    where: "status = 'invalidated'",
    period: "retiredDevices",
    action: "remove",
  },

  // Finished privacy work. The record that an erasure or an export happened is
  // worth keeping while somebody might ask, and it names an opaque identifier
  // rather than anybody.
  {
    name: "finished erasures",
    table: "erasure_requests",
    column: "completed_at",
    where: "state <> 'pending'",
    period: "privacyRequests",
    action: "remove",
  },
  {
    name: "finished exports",
    table: "export_requests",
    column: "completed_at",
    where: "state <> 'pending'",
    period: "privacyRequests",
    action: "remove",
  },

  // The security records `product/privacy.md:618` allows to outlive a deletion.
  // Long, and bounded: retaining data only as long as necessary has to be true
  // of the category most likely to be examined, or it is not a principle.
  {
    name: "authentication audit",
    table: "auth_audit_events",
    column: "occurred_at",
    where: "true",
    period: "auditEvents",
    action: "remove",
  },
  {
    name: "authorization audit",
    table: "authorization_audit_events",
    column: "occurred_at",
    where: "true",
    period: "auditEvents",
    action: "remove",
  },
];

/**
 * The instant before which rows of a given age are past their period.
 *
 * @param now - The instant to measure from.
 * @param days - How long the category is kept.
 * @returns The cutoff. A period of zero yields `now`, which sweeps everything
 *   already finished — useful for a deployment that wants nothing retained, and
 *   the reason the tests can set a period to zero and watch a guard fail.
 * @throws {RangeError} If the period is negative. A cutoff in the future would
 *   sweep rows that have not aged at all, which is not a retention policy but a
 *   deletion of everything, and it should be impossible to configure by
 *   accident.
 */
export function cutoff(now: Date, days: number): Date {
  if (days < 0) {
    throw new RangeError("A retention period cannot be negative");
  }

  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
}
