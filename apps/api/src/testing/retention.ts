import type { RetentionPeriods } from "../features/privacy/retention.policy.js";

/**
 * Retention periods for suites that are not about retention.
 *
 * Long enough that nothing ages out during a test run, so a suite about
 * notifications or moments never has rows swept from under it. The retention
 * suite sets its own periods instead, which is the only place the numbers
 * matter.
 *
 * Deliberately not the production defaults. Those live in `config/env.ts` and
 * have one home; copying them here would be two places to change and one to
 * forget.
 */
export const TEST_RETENTION_PERIODS: RetentionPeriods = {
  signInArtefacts: 3_650,
  readNotifications: 3_650,
  notifications: 3_650,
  requiredNotifications: 3_650,
  notificationDeduplication: 3_650,
  deliveryRecords: 3_650,
  dormantDevices: 3_650,
  retiredDevices: 3_650,
  auditEvents: 3_650,
  privacyRequests: 3_650,
};
