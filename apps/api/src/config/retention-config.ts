import type { Env } from "./env.js";
import type { RetentionPeriods } from "../features/privacy/retention.policy.js";

/**
 * How long each category of operational residue is kept.
 *
 * Configuration rather than constants, following `OUTBOX_RETENTION_HOURS`. A
 * retention period is an operator's decision and often a legal one, and it
 * should not take a deployment to change — nor should the number somebody
 * eventually has to justify be buried in a source file.
 *
 * Every period is in days, which is the unit these are actually discussed in.
 */
export interface RetentionConfig {
  readonly periods: RetentionPeriods;
}

/**
 * Derive retention periods from the environment.
 *
 * @param env - The validated environment.
 * @returns How long each category is kept.
 */
export function toRetentionConfig(env: Env): RetentionConfig {
  return {
    periods: {
      signInArtefacts: env.RETAIN_SIGN_IN_ARTEFACTS_DAYS,
      readNotifications: env.RETAIN_READ_NOTIFICATIONS_DAYS,
      notifications: env.RETAIN_NOTIFICATIONS_DAYS,
      requiredNotifications: env.RETAIN_REQUIRED_NOTIFICATIONS_DAYS,
      notificationDeduplication: env.RETAIN_NOTIFICATION_DEDUPLICATION_DAYS,
      deliveryRecords: env.RETAIN_DELIVERY_RECORDS_DAYS,
      dormantDevices: env.RETIRE_DORMANT_DEVICES_DAYS,
      retiredDevices: env.RETAIN_RETIRED_DEVICES_DAYS,
      auditEvents: env.RETAIN_AUDIT_EVENTS_DAYS,
      privacyRequests: env.RETAIN_PRIVACY_REQUESTS_DAYS,
    },
  };
}
