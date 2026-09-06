import { z } from "zod";
import { errorResponseSchema } from "./errors.js";
import {
  commentPageSchema,
  commentSchema,
  momentPageSchema,
  momentPlaceSchema,
  momentRelationshipSchema,
  personalSignificanceSchema,
  reactionSummarySchema,
  momentSchema,
} from "./moments.js";
import { currentUserSchema, preferencesSchema, publicUserSchema } from "./users.js";
import {
  heldPhoneSchema,
  sessionCredentialsSchema,
  sessionListSchema,
  sessionSummarySchema,
} from "./auth.js";
import { uploadAuthorizationSchema, uploadListSchema, uploadSchema } from "./uploads.js";
import {
  coordinatesSchema,
  geographicContextSchema,
  locationSchema,
  placeSuggestionsSchema,
} from "./locations.js";
import { realWorldEventSchema } from "./real-world-events.js";
import {
  savedViewListSchema,
  savedViewSchema,
  savedViewShareListSchema,
  savedViewShareSchema,
  sharedViewSchema,
} from "./saved-views.js";
import {
  followListSchema,
  followRequestListSchema,
  followRequestSchema,
  followSchema,
  followedEventListSchema,
  followedLocationListSchema,
} from "./social.js";
import {
  deliverySettingsSchema,
  deviceSchema,
  notificationPageSchema,
  notificationPreferencesSchema,
  notificationSchema,
  unreadCountSchema,
} from "./notifications.js";
import {
  accuracyReportPageSchema,
  appealPageSchema,
  appealSchema,
  moderationReportPageSchema,
  moderationReportSchema,
  moderationSubjectStateSchema,
  ownModerationHistoryPageSchema,
  ownReportPageSchema,
  ownReportSchema,
  suspensionSchema,
} from "./moderation.js";
import {
  momentParticipantsSchema,
  participationListSchema,
  participationRefusalListSchema,
  participationSchema,
} from "./participation.js";
import { searchPageSchema, searchResultSchema, searchSuggestionsSchema } from "./search.js";
import { discoverabilitySchema, recommendationPageSchema, recommendationSchema } from "./discovery.js";
import { capabilitiesSchema, userRolesSchema } from "./authorization.js";
import { exportManifestSchema, exportStatusSchema } from "./export.js";
import { occurrenceSchema } from "./time.js";

/**
 * Public names for the shapes that cross the API boundary.
 *
 * **A shape without a name is a shape nobody can refer to**, and the generated
 * OpenAPI document had none: `components.schemas` was empty and every schema was
 * written out in full at every use site. Two and a half megabytes, and a Moment
 * described thirty-six separate times.
 *
 * That defeated the reason ADR-112 gave for committing the document in the first
 * place — "a diff in `openapi.json` on a pull request says 'the boundary
 * moved'." Adding a field to a Moment produced thirty-six identical diff hunks,
 * which says nothing at all. With a name it produces one.
 *
 * **These ids are a public vocabulary**, which is why they live here rather than
 * in the API: they are the words anybody reading the document, importing it into
 * a tool, or generating from it will use. The same reason this package's barrel
 * is an explicit list rather than `export *`.
 *
 * **Named: what repeats.** Entities, pages, and the value objects that appear
 * inside many of them. Not every leaf — naming `captionSchema` buys nothing,
 * because a caption appears in two places and reads perfectly well inline.
 * Naming `momentSchema` buys thirty-six.
 *
 * **Requests are deliberately absent.** Each belongs to exactly one operation,
 * so a name would be a second way to say what the operation already says, and
 * `$ref` reuse buys nothing where there is no reuse.
 */
export const contractRegistry = z.registry<{ id: string }>();

/**
 * Give a schema its public name.
 *
 * @param schema - The schema to name.
 * @param id - The name it takes in `components.schemas`. Stable: changing one
 *   changes the published document and anything generated from it.
 * @returns Nothing.
 */
function name(schema: z.ZodType, id: string): void {
  contractRegistry.add(schema, { id });
}

// Shared value objects, which is where the duplication was worst.
name(errorResponseSchema, "ErrorResponse");
name(occurrenceSchema, "Occurrence");
name(coordinatesSchema, "Coordinates");
name(geographicContextSchema, "GeographicContext");

// Moments and everything that hangs off one.
name(momentSchema, "Moment");
name(momentPageSchema, "MomentPage");
name(momentPlaceSchema, "MomentPlace");
name(momentRelationshipSchema, "MomentRelationship");
name(reactionSummarySchema, "ReactionSummary");
name(personalSignificanceSchema, "PersonalSignificance");
name(commentSchema, "Comment");
name(commentPageSchema, "CommentPage");

// People.
name(publicUserSchema, "PublicUser");
name(currentUserSchema, "CurrentUser");
name(preferencesSchema, "Preferences");

// Sessions.
name(sessionCredentialsSchema, "SessionCredentials");
name(sessionSummarySchema, "SessionSummary");
name(sessionListSchema, "SessionList");
name(heldPhoneSchema, "HeldPhone");

// Media.
name(uploadSchema, "Upload");
name(uploadListSchema, "UploadList");
name(uploadAuthorizationSchema, "UploadAuthorization");

// Places and occasions.
name(locationSchema, "Location");
name(placeSuggestionsSchema, "PlaceSuggestions");
name(realWorldEventSchema, "RealWorldEvent");

// Saved Views.
name(savedViewSchema, "SavedView");
name(savedViewListSchema, "SavedViewList");
name(savedViewShareSchema, "SavedViewShare");
name(savedViewShareListSchema, "SavedViewShareList");
name(sharedViewSchema, "SharedView");

// Following and blocking.
name(followSchema, "Follow");
name(followListSchema, "FollowList");
name(followRequestSchema, "FollowRequest");
name(followRequestListSchema, "FollowRequestList");
name(followedEventListSchema, "FollowedEventList");
name(followedLocationListSchema, "FollowedLocationList");

// Notifications.
name(notificationSchema, "Notification");
name(notificationPageSchema, "NotificationPage");
name(unreadCountSchema, "UnreadCount");
name(notificationPreferencesSchema, "NotificationPreferences");
name(deviceSchema, "Device");
name(deliverySettingsSchema, "DeliverySettings");

// Moderation, on both sides of the glass.
name(ownReportSchema, "OwnReport");
name(ownReportPageSchema, "OwnReportPage");
name(moderationReportSchema, "ModerationReport");
name(moderationReportPageSchema, "ModerationReportPage");
name(accuracyReportPageSchema, "AccuracyReportPage");
name(moderationSubjectStateSchema, "ModerationSubjectState");
name(ownModerationHistoryPageSchema, "OwnModerationHistoryPage");
name(appealSchema, "Appeal");
name(appealPageSchema, "AppealPage");
name(suspensionSchema, "Suspension");

// Participation.
name(participationSchema, "Participation");
name(participationListSchema, "ParticipationList");
name(participationRefusalListSchema, "ParticipationRefusalList");
name(momentParticipantsSchema, "MomentParticipants");

// Finding things.
name(searchResultSchema, "SearchResult");
name(searchPageSchema, "SearchPage");
name(searchSuggestionsSchema, "SearchSuggestions");
name(recommendationSchema, "Recommendation");
name(recommendationPageSchema, "RecommendationPage");
name(discoverabilitySchema, "Discoverability");

// Roles, and leaving.
name(capabilitiesSchema, "Capabilities");
name(userRolesSchema, "UserRoles");
name(exportStatusSchema, "ExportStatus");
name(exportManifestSchema, "ExportManifest");
