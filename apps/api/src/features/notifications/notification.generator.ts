import type { DataSource } from "typeorm";
import { generateId } from "../../lib/ids/generate-id.js";
import { withTransaction } from "../../lib/database/transaction.js";
import type { MomentService } from "../moments/moment.service.js";
import {
  aggregates,
  aggregationKey,
  categoryOf,
  permits,
  recipientOf,
  type NotificationSourceType,
} from "./notification.policy.js";
import type { NotificationDeliveryService } from "./notification.delivery.service.js";
import type { NotificationRepository } from "./notification.repository.js";

/** What one message says happened, once it has been read. */
export interface Candidate {
  readonly type: string;
  /**
   * Who did it, where anybody did.
   *
   * Absent for a moderation decision: the affected person is told what happened
   * to their content and never which moderator decided it, so there is nobody
   * to name.
   */
  readonly actorUserId: string | undefined;
  /** Who the message names as the person it happened to. */
  readonly subjectUserId: string;
  readonly sourceType: NotificationSourceType;
  readonly sourceId: string;
  /**
   * The Moment whose visibility decides whether the recipient may know.
   *
   * Absent where the activity is not about a Moment — somebody following you,
   * your own upload — in which case the recipient is the subject of their own
   * notification and there is nothing to check.
   */
  readonly viaMomentId?: string | undefined;
}

/** What happened to a candidate. */
export type Outcome = "notified" | "no_recipient" | "not_eligible" | "suppressed" | "duplicate";

/**
 * Turning activity into notifications.
 *
 * The order matters, and `notifications.md:200` fixes it: is there somebody to
 * tell, are they entitled to know, and only then do they want to hear about it.
 *
 * Preferences come last for a reason the document states plainly — they cannot
 * grant access somebody otherwise lacks. Asked earlier, an enabled preference
 * would look like a reason to notify, and the eligibility check would become
 * something a future branch could skip.
 */
export class NotificationGenerator {
  /**
   * Build the generator.
   *
   * @param dataSource - Opens the transaction a notification and its actor
   *   commit in.
   * @param notifications - Where notifications are written.
   * @param moments - Used to ask whether the recipient may see the Moment the
   *   activity concerns. The Moment visibility rule, reused rather than
   *   restated.
   * @param deliveries - Opens the deliveries that carry a notification out of
   *   the application. Optional, and absent it records notifications and
   *   carries them nowhere — which is what 5Q-1 did, and is still the correct
   *   behaviour for a process that has no way to send.
   * @param now - Reads the clock, injected so ordering can be tested.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationRepository,
    private readonly moments: MomentService,
    private readonly deliveries?: NotificationDeliveryService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Consider one piece of activity.
   *
   * @param candidate - What happened.
   * @param sourceEventId - The message that carried it, which is what makes
   *   this idempotent: the same message twice adds the same actor row twice,
   *   and the unique index refuses the second.
   * @returns What happened to it, so a caller can report it and a test can
   *   assert it. Every outcome but `notified` is ordinary rather than a
   *   failure.
   */
  async consider(candidate: Candidate, sourceEventId: string): Promise<Outcome> {
    const recipientUserId = recipientOf(candidate);

    if (recipientUserId === undefined) {
      return "no_recipient";
    }

    const category = categoryOf(candidate.type);

    if (category === undefined) {
      return "no_recipient";
    }

    if (!(await this.mayKnow(candidate, recipientUserId))) {
      return "not_eligible";
    }

    // The in-app preference decides whether the notification exists at all,
    // because the notification row is the in-app notification
    // (`architecture/notifications.md:727`). Switching a category off in-app
    // therefore silences its email and push as well — there is nothing left for
    // them to carry — while switching off email or push leaves the in-app
    // entry standing, which is the asymmetry the document asks for. A required
    // category is unaffected: `permits` returns true for one whatever is
    // stored.
    const preference = await this.notifications.preferenceFor(
      recipientUserId,
      category,
      "in_app",
    );

    if (!permits(category, preference)) {
      return "suppressed";
    }

    const at = this.now();

    // Required notifications do not collapse. A delivery is opened once per
    // notification per channel, so a second password change folding into a
    // standing unread entry would be announced to nobody — and the message
    // somebody most needs is the one saying it has happened again.
    const key = aggregationKey(recipientUserId, candidate.type, candidate.sourceId);
    const collapsesInto = aggregates(category) ? key : `${key}:${sourceEventId}`;

    // One transaction for the notification and everything that will carry it.
    // Recording first and scheduling afterwards would be a dual write whose
    // failure mode is a notification nobody is ever told about.
    const notificationId = await withTransaction(this.dataSource, async (tx) => {
      const recorded = await this.notifications.record(tx, {
        notificationId: generateId(),
        recipientUserId,
        type: candidate.type,
        category,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        aggregationKey: collapsesInto,
        viaMomentId: candidate.viaMomentId,
        actorUserId: candidate.actorUserId,
        sourceEventId,
        at,
      });

      if (recorded !== undefined) {
        await this.deliveries?.schedule(tx, {
          notificationId: recorded,
          recipientUserId,
          category,
          at,
        });
      }

      return recorded;
    });

    return notificationId !== undefined ? "notified" : "duplicate";
  }

  /**
   * Whether the recipient is entitled to know this happened.
   *
   * Asked before preferences and never after. The check is the Moment
   * visibility rule rather than a second opinion about it — a notification is
   * one of the easiest ways to tell somebody that a Moment exists, so the
   * question "may they see it" has to be the same question everywhere.
   *
   * @param candidate - What happened.
   * @param recipientUserId - Who would be told.
   * @returns Whether to go on. True where the activity concerns no Moment: the
   *   recipient is then the subject of their own notification — their upload,
   *   their content, somebody following them — and there is nothing they could
   *   fail to be entitled to.
   */
  private async mayKnow(candidate: Candidate, recipientUserId: string): Promise<boolean> {
    if (candidate.viaMomentId === undefined) {
      return true;
    }

    try {
      await this.moments.get(candidate.viaMomentId, recipientUserId);

      return true;
    } catch {
      // Refusals are reported as absence, which is the right reading here: if
      // they cannot see it, they are not told about it.
      return false;
    }
  }
}
