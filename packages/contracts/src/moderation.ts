import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";

/**
 * Moderation boundary contracts.
 *
 * The distinction the whole feature rests on: moderation decides what
 * Chronologity distributes, not what happened (`moderation.md:151`). A removed
 * Moment did not stop occurring, and nothing here alters occurrence,
 * authorship, or position in chronology.
 *
 * The spellings cross runtime boundaries — the mobile client renders warnings
 * and report forms, and the feed aggregator will apply the same states to its
 * reads — so they are canonical here. Which state a subject is in, and who may
 * put it there, stays server-side.
 */

/**
 * What Chronologity is doing about one thing.
 *
 * The seven states of `moderation.md:159`, in increasing order of
 * consequence. The document is explicit that a binary `allowed / deleted`
 * (`moderation.md:151`) is too coarse for a platform holding history: the
 * middle states are what let Chronologity restrict distribution without
 * asserting that something did not happen.
 *
 * `warned` and `restricted_from_amplification` hide nothing from a direct
 * reader. The second is the line `moderation.md:211` draws — allowed to be
 * accessed directly, not eligible for Discovery, broad Search, or
 * recommendation — and it is enforced by the surfaces that amplify.
 */
export const moderationStateSchema = z.enum([
  "allowed",
  "warned",
  "restricted_from_amplification",
  "restricted_to_authorized_audience",
  "age_restricted",
  "temporarily_unavailable",
  "removed",
]);

export type ModerationState = z.infer<typeof moderationStateSchema>;

/**
 * What kind of thing a moderation decision is about.
 *
 * `media` is here because a Moment is an experience rather than a file: one
 * unacceptable photograph should not require removing an entire experience,
 * and `moments.md` treats the media as evidence of the Moment rather than as
 * the Moment itself.
 */
export const moderationSubjectTypeSchema = z.enum(["moment", "comment", "user", "media"]);

export type ModerationSubjectType = z.infer<typeof moderationSubjectTypeSchema>;

/**
 * Why somebody reported something.
 *
 * The high-level list of `moderation.md:563`, which asks for reasons
 * "understandable to ordinary Users rather than mirroring internal policy
 * taxonomies too literally". The final taxonomy awaits policy and legal
 * review, so these are the reporting vocabulary rather than the policy itself.
 *
 * Two of that list are deliberately absent. False or misleading historical
 * information is an accuracy report and has its own reasons below; routing it
 * here would put safety moderators in charge of historical metadata, which
 * `moderation.md:600` warns against. An intellectual-property concern belongs
 * to "the appropriate process" — a legal one with its own notice and
 * counter-notice requirements — and offering it as an ordinary report reason
 * would misroute a claim that needs different handling.
 */
export const reportReasonSchema = z.enum([
  "harassment",
  "threat",
  "hate",
  "sexual_content",
  "graphic_content",
  "privacy_violation",
  "impersonation",
  "spam",
  "illegal_content",
  "other",
]);

export type ReportReason = z.infer<typeof reportReasonSchema>;

/**
 * Why somebody says a Moment is historically wrong.
 *
 * `moderation.md:585` gives the example that separates these from safety
 * reports: "This Moment occurred in 2004, not 2005" is a correction, and
 * "This content threatens me" is not.
 */
export const accuracyReportReasonSchema = z.enum([
  "wrong_date",
  "wrong_place",
  "wrong_event",
  "other",
]);

export type AccuracyReportReason = z.infer<typeof accuracyReportReasonSchema>;

/**
 * Where a report has got to.
 *
 * The four of `moderation.md:632`. `resolved` means somebody decided;
 * `closed` means the report ended without one, which is what happens to a
 * duplicate or a report of something that turned out not to breach anything.
 * Both are terminal.
 */
export const reportStatusSchema = z.enum(["submitted", "under_review", "resolved", "closed"]);

export type ReportStatus = z.infer<typeof reportStatusSchema>;

/**
 * How urgently a report should be looked at.
 *
 * Ordering only. `moderation.md:614` is explicit that report volume "may
 * affect review prioritization" but must never establish that content violates
 * policy, so nothing in the system reads this to decide an outcome.
 */
export const reviewPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export type ReviewPriority = z.infer<typeof reviewPrioritySchema>;

/**
 * Whether a person or a program did this.
 *
 * `moderation.md:835` requires provenance for moderation decisions, and
 * automation here is triage only: it orders a queue and never sets a state. The
 * column exists so the two can never be confused after the fact, which matters
 * most when somebody asks why something happened to them.
 */
export const moderationActorKindSchema = z.enum(["human", "automated"]);

export type ModerationActorKind = z.infer<typeof moderationActorKindSchema>;

/** Whether a moderation attempt was carried out or refused. */
export const moderationOutcomeSchema = z.enum(["success", "failure"]);

export type ModerationOutcome = z.infer<typeof moderationOutcomeSchema>;

/** Reporting something. */
export const submitReportRequestSchema = z.object({
  subjectType: moderationSubjectTypeSchema,
  subjectId: identifierSchema,
  reason: reportReasonSchema,
  /** What the reporter wants a moderator to know. */
  detail: z.string().trim().min(1).max(2000).optional(),
});

export type SubmitReportRequest = z.infer<typeof submitReportRequestSchema>;

/**
 * A report as the person who filed it sees it.
 *
 * Status and nothing more. `moderation.md:637` says the product "need not
 * reveal sensitive internal moderation details, classifier results, reviewer
 * identity, or information about another User that the reporter is not
 * entitled to receive" — so there is no reviewer here, no priority, and
 * nothing about the person reported. A reporter learns that their report was
 * dealt with, not what was decided about somebody else.
 */
export const ownReportSchema = z.object({
  reportId: identifierSchema,
  subjectType: moderationSubjectTypeSchema,
  subjectId: identifierSchema,
  reason: reportReasonSchema,
  status: reportStatusSchema,
  createdAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
});

export type OwnReport = z.infer<typeof ownReportSchema>;

/** A page of your own reports. */
export const ownReportPageSchema = z.object({
  reports: z.array(ownReportSchema),
  nextCursor: z.string().optional(),
});

export type OwnReportPage = z.infer<typeof ownReportPageSchema>;

/**
 * A report as a moderator sees it.
 *
 * Carries the reporter, which the subject never receives: `moderation.md:541`
 * expects people to report conduct they believe breaks the rules, and somebody
 * who fears being identified for it will not.
 */
export const moderationReportSchema = z.object({
  reportId: identifierSchema,
  subjectType: moderationSubjectTypeSchema,
  subjectId: identifierSchema,
  reporterUserId: identifierSchema,
  reason: reportReasonSchema,
  detail: z.string().nullable(),
  status: reportStatusSchema,
  priority: reviewPrioritySchema,
  /**
   * How many separate people have reported this subject.
   *
   * Shown so a reviewer can see the scale of what they are looking at, and
   * bounded by one report per person. It orders the queue and decides nothing.
   */
  reportCount: z.number().int().min(1),
  /**
   * Whether the reports on this subject arrived in a short burst.
   *
   * Deliberately not an escalation. A burst may mean many people saw something
   * awful at once, or it may mean a group agreed to report somebody; the flag
   * says which question to ask, and `moderation.md:614` forbids it answering.
   */
  burst: z.boolean(),
  createdAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
});

export type ModerationReport = z.infer<typeof moderationReportSchema>;

/** A page of the queue. */
export const moderationReportPageSchema = z.object({
  reports: z.array(moderationReportSchema),
  nextCursor: z.string().optional(),
});

export type ModerationReportPage = z.infer<typeof moderationReportPageSchema>;

/** Moving a report through its statuses. */
export const resolveReportRequestSchema = z.object({
  status: z.enum(["under_review", "resolved", "closed"]),
  note: z.string().trim().min(1).max(2000).optional(),
});

export type ResolveReportRequest = z.infer<typeof resolveReportRequestSchema>;

/** Reporting that a Moment says the wrong thing about history. */
export const submitAccuracyReportRequestSchema = z.object({
  momentId: identifierSchema,
  reason: accuracyReportReasonSchema,
  /** What the reporter believes is true instead, in their own words. */
  detail: z.string().trim().min(1).max(2000),
});

export type SubmitAccuracyReportRequest = z.infer<typeof submitAccuracyReportRequestSchema>;

/**
 * A historical-accuracy report.
 *
 * One shape for both audiences, unlike safety reports: an accuracy report is a
 * claim about history rather than about a person, so there is nothing in it a
 * reporter must be shielded from. It carries no moderation state, because
 * `moderation.md:527` separates a historical correction from a moderation
 * action — a wrong date is a thing to fix, not a thing to enforce against.
 */
export const accuracyReportSchema = z.object({
  reportId: identifierSchema,
  momentId: identifierSchema,
  reporterUserId: identifierSchema,
  reason: accuracyReportReasonSchema,
  detail: z.string(),
  status: reportStatusSchema,
  createdAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
});

export type AccuracyReport = z.infer<typeof accuracyReportSchema>;

/** A page of accuracy reports. */
export const accuracyReportPageSchema = z.object({
  reports: z.array(accuracyReportSchema),
  nextCursor: z.string().optional(),
});

export type AccuracyReportPage = z.infer<typeof accuracyReportPageSchema>;

/** Putting something into a moderation state. */
export const setModerationStateRequestSchema = z.object({
  state: moderationStateSchema,
  /**
   * Why, in a moderator's words.
   *
   * Required rather than optional: `moderation.md:680` expects somebody
   * affected to be told the reason, and a decision recorded without one cannot
   * be explained later or defended in an appeal.
   */
  reason: z.string().trim().min(1).max(2000),
});

export type SetModerationStateRequest = z.infer<typeof setModerationStateRequestSchema>;

/** What Chronologity is currently doing about one thing. */
export const moderationSubjectStateSchema = z.object({
  subjectType: moderationSubjectTypeSchema,
  subjectId: identifierSchema,
  state: moderationStateSchema,
  decidedAt: timestampSchema,
});

export type ModerationSubjectState = z.infer<typeof moderationSubjectStateSchema>;

/** Suspending an account, or letting it back. */
export const setSuspensionRequestSchema = z.object({
  suspended: z.boolean(),
  reason: z.string().trim().min(1).max(2000),
});

export type SetSuspensionRequest = z.infer<typeof setSuspensionRequestSchema>;

/** Whether an account is suspended, after the change. */
export const suspensionSchema = z.object({
  userId: identifierSchema,
  suspended: z.boolean(),
});

export type Suspension = z.infer<typeof suspensionSchema>;

/**
 * Something that was done to your content, as you are told about it.
 *
 * What makes an appeal possible: `moderation.md:680` expects the reason for an
 * action to reach the person it affected, and nobody can contest a decision
 * they were never told about. Carries no reviewer identity.
 */
export const ownModerationRecordSchema = z.object({
  actionId: identifierSchema,
  subjectType: moderationSubjectTypeSchema,
  subjectId: identifierSchema,
  state: moderationStateSchema,
  reason: z.string(),
  decidedAt: timestampSchema,
  /** Whether this action has already been contested, and how it went. */
  appealStatus: z.enum(["none", "open", "upheld", "reversed"]),
});

export type OwnModerationRecord = z.infer<typeof ownModerationRecordSchema>;

/** A page of your own moderation history. */
export const ownModerationHistoryPageSchema = z.object({
  records: z.array(ownModerationRecordSchema),
  nextCursor: z.string().optional(),
});

export type OwnModerationHistoryPage = z.infer<typeof ownModerationHistoryPageSchema>;

/** Contesting something done to you. */
export const submitAppealRequestSchema = z.object({
  actionId: identifierSchema,
  statement: z.string().trim().min(1).max(4000),
});

export type SubmitAppealRequest = z.infer<typeof submitAppealRequestSchema>;

/** How an appeal ended. */
export const appealOutcomeSchema = z.enum(["upheld", "reversed"]);

export type AppealOutcome = z.infer<typeof appealOutcomeSchema>;

/** Where an appeal has got to. */
export const appealStatusSchema = z.enum(["open", "decided"]);

export type AppealStatus = z.infer<typeof appealStatusSchema>;

/**
 * An appeal.
 *
 * One shape for the appellant and the moderator. Unlike a report there is no
 * third party to protect: an appeal is about a decision Chronologity made, and
 * the person who made it is the platform rather than another User.
 */
export const appealSchema = z.object({
  appealId: identifierSchema,
  actionId: identifierSchema,
  appellantUserId: identifierSchema,
  statement: z.string(),
  status: appealStatusSchema,
  outcome: appealOutcomeSchema.nullable(),
  /** A moderator's explanation of the decision, once there is one. */
  resolution: z.string().nullable(),
  createdAt: timestampSchema,
  decidedAt: timestampSchema.nullable(),
});

export type Appeal = z.infer<typeof appealSchema>;

/** A page of appeals. */
export const appealPageSchema = z.object({
  appeals: z.array(appealSchema),
  nextCursor: z.string().optional(),
});

export type AppealPage = z.infer<typeof appealPageSchema>;

/**
 * Deciding an appeal.
 *
 * Reversing restores what the action restricted, which is where "nothing was
 * deleted" stops being a claim and becomes something a test can check.
 */
export const decideAppealRequestSchema = z.object({
  outcome: appealOutcomeSchema,
  resolution: z.string().trim().min(1).max(2000),
});

export type DecideAppealRequest = z.infer<typeof decideAppealRequestSchema>;

/** What a caller may ask for when listing anything in this feature. */
export const listModerationRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export type ListModerationRequest = z.infer<typeof listModerationRequestSchema>;
