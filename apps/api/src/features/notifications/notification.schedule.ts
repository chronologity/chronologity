/**
 * When a notification is delivered, as opposed to whether it is.
 *
 * Pure, and separated from everything that touches a database, because this is
 * where the mistakes in delivery actually live. A privacy rule read wrongly
 * leaks; arithmetic read wrongly wakes somebody at three in the morning, and
 * the way that happens is almost always the same — a time zone treated as a
 * fixed offset, so the code is right for seven months of the year.
 *
 * The whole of quiet hours and digests is resolved here, once, when a delivery
 * is created. What is stored is an instant, and the only question the dispatcher
 * ever asks afterwards is whether that instant has passed. A dispatcher that
 * never looks at a time zone cannot get one wrong.
 *
 * `product/notifications.md:533` fixes what these rules may and may not do:
 * they affect delivery time only. Nothing here can decide that something is not
 * delivered — the latest any rule can say is "later".
 */

/**
 * How much a notification is allowed to wait.
 *
 * Three answers rather than two, because two would force account security and a
 * moderation decision to behave alike and they should not.
 */
export type Urgency =
  /**
   * Waits for nothing.
   *
   * Account security. A password changed at three in the morning is the thing
   * somebody needs waking for, because by morning the account may be gone.
   */
  | "immediate"
  /**
   * Never gathered into a digest, but waits out a quiet window.
   *
   * A moderation decision will still be there at eight, and appealing it is no
   * more possible at three. Waking somebody for it teaches them to silence the
   * device — which silences the security alert too, so the cost of getting this
   * one wrong is paid by the category above.
   */
  | "prompt"
  /** Everything else: digested if asked for, and quiet hours apply. */
  | "ordinary";

/** The hours nothing ordinary is delivered in, as local hours. */
export interface QuietWindow {
  /** Quiet begins at the top of this hour, and this hour is quiet. */
  readonly from: number;
  /** Quiet ends at the top of this hour, and this hour is not quiet. */
  readonly until: number;
}

/** How one channel delivers. */
export interface DeliverySchedule {
  readonly mode: "immediate" | "digest";
  /** Local hour a digest goes out. */
  readonly digestHour: number;
  /** Absent for no quiet hours at all. */
  readonly quiet: QuietWindow | undefined;
}

/** What a clock reads somewhere. */
interface LocalTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/**
 * Built formatters, kept because building one costs far more than using it and
 * the dispatcher asks for the same handful of zones over and over.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * When to deliver.
 *
 * @param at - When the activity happened. Nothing here changes it:
 *   `product/notifications.md:535` requires that a delayed notification still
 *   represents activity that occurred earlier, so the delay lives on the
 *   delivery and never on the notification.
 * @param urgency - How much this is allowed to wait.
 * @param schedule - The account's settings for this channel.
 * @param timeZone - An IANA zone. One this runtime does not recognise is read
 *   as UTC rather than throwing.
 * @returns The instant to deliver at, never earlier than `at`.
 */
export function dueAt(
  at: Date,
  urgency: Urgency,
  schedule: DeliverySchedule,
  timeZone: string,
): Date {
  if (urgency === "immediate") {
    return at;
  }

  const zone = usableZone(timeZone);

  // The digest first, then quiet hours over the top of it. That order matters
  // for somebody who has set a digest hour inside their own quiet window: the
  // digest moves to the end of the window, rather than the window being ignored
  // because a digest was asked for.
  const base =
    urgency === "ordinary" && schedule.mode === "digest"
      ? nextLocalHour(at, schedule.digestHour, zone)
      : at;

  return afterQuietHours(base, schedule.quiet, zone);
}

/**
 * A zone this runtime can actually resolve.
 *
 * @param timeZone - What the account has stored, which by delivery time is a
 *   string somebody chose months ago on a device this process has never seen.
 * @returns It, or UTC where the runtime does not recognise it. Falling back
 *   rather than throwing, because the consequence of throwing is that no
 *   delivery is ever scheduled: a stale preference would become silence, and
 *   for a security notification silence is the failure that matters.
 */
export function usableZone(timeZone: string): string {
  try {
    formatterFor(timeZone);

    return timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * Push an instant past a quiet window, if it lands inside one.
 *
 * @param instant - When delivery would otherwise happen.
 * @param quiet - The window, or undefined where there is none.
 * @param zone - A zone already known to be usable.
 * @returns The instant, or the end of the window. A window whose ends meet
 *   never reaches here — the contract and the database both refuse one, because
 *   `22` to `22` reads equally well as no quiet hours and as a whole day of
 *   them, and choosing either would give somebody a setting they did not ask
 *   for.
 */
function afterQuietHours(instant: Date, quiet: QuietWindow | undefined, zone: string): Date {
  if (quiet === undefined) {
    return instant;
  }

  const { hour } = localTime(instant, zone);

  // Two readings of one pair, and the wrapping one is the ordinary case: quiet
  // hours almost always run from an evening into a morning, so a comparison
  // that only handled `from < until` would be wrong for nearly everybody who
  // set them.
  const inside =
    quiet.from < quiet.until
      ? hour >= quiet.from && hour < quiet.until
      : hour >= quiet.from || hour < quiet.until;

  return inside ? nextLocalHour(instant, quiet.until, zone) : instant;
}

/**
 * The next instant at which the local clock reads a given hour.
 *
 * @param after - The instant to look forward from.
 * @param hour - The local hour wanted, 0 to 23.
 * @param zone - A zone already known to be usable.
 * @returns That instant, always later than `after`. Today's if it is still
 *   ahead and tomorrow's otherwise — so a digest hour that has already passed
 *   produces tomorrow's rather than an instant in the past, and an hour
 *   arriving exactly now counts as arrived.
 */
function nextLocalHour(after: Date, hour: number, zone: string): Date {
  const today = localTime(after, zone);
  const candidate = instantOfLocal({ ...today, hour, minute: 0 }, zone);

  if (candidate.getTime() > after.getTime()) {
    return candidate;
  }

  // The next local date rather than another twenty-four hours. On the day
  // clocks move, those differ by an hour, and adding a fixed span would deliver
  // a nine o'clock digest at eight or at ten.
  const rolled = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));

  return instantOfLocal(
    {
      year: rolled.getUTCFullYear(),
      month: rolled.getUTCMonth() + 1,
      day: rolled.getUTCDate(),
      hour,
      minute: 0,
    },
    zone,
  );
}

/**
 * What the clock reads in a zone at an instant.
 *
 * @param instant - The moment.
 * @param zone - A zone already known to be usable.
 * @returns The local date, hour, and minute.
 */
function localTime(instant: Date, zone: string): LocalTime {
  const parts = formatterFor(zone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

/**
 * The instant at which a zone's clock reads a given local time.
 *
 * The inverse of `localTime`, which the platform offers no direct way to
 * compute: `Intl` turns instants into clock readings and never the other way.
 * So the offset is measured at a first guess and applied, then measured again
 * at the result — the second pass being what makes the day clocks move come out
 * right, because the offset at the guess and the offset at the answer differ by
 * exactly the hour that moved.
 *
 * @param local - The wanted local date and hour.
 * @param zone - A zone already known to be usable.
 * @returns The instant. A local hour that does not exist — the one skipped when
 *   clocks go forward — resolves to the instant just after the gap, which is
 *   the first moment that hour can be said to have arrived. A local hour that
 *   happens twice, when clocks go back, resolves to the second of them, so a
 *   quiet window ending in it ends an hour later than on an ordinary day. Both
 *   are bounded by one hour, and neither can move a delivery earlier.
 */
function instantOfLocal(local: LocalTime, zone: string): Date {
  const wanted = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const firstGuess = new Date(wanted - offsetAt(new Date(wanted), zone));

  return new Date(wanted - offsetAt(firstGuess, zone));
}

/**
 * How far ahead of UTC a zone is at an instant.
 *
 * @param instant - The moment.
 * @param zone - A zone already known to be usable.
 * @returns The offset in milliseconds, positive east of Greenwich. Measured
 *   rather than looked up, because the only thing that knows a zone's rules —
 *   including the day they change — is the runtime's own zone database.
 */
function offsetAt(instant: Date, zone: string): number {
  const local = localTime(instant, zone);

  // Truncated to the minute on both sides. Zone offsets have been whole minutes
  // everywhere since 1972, and comparing to the millisecond would make the
  // offset carry the instant's own seconds.
  return (
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) -
    Math.floor(instant.getTime() / 60_000) * 60_000
  );
}

/**
 * A formatter for a zone, built once.
 *
 * @param zone - The zone.
 * @returns The formatter.
 * @throws {RangeError} If the runtime does not recognise the zone. Caught by
 *   `usableZone`, which is the only place a zone that has not been checked
 *   arrives from.
 */
function formatterFor(zone: string): Intl.DateTimeFormat {
  const existing = formatters.get(zone);

  if (existing !== undefined) {
    return existing;
  }

  const built = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  formatters.set(zone, built);

  return built;
}
