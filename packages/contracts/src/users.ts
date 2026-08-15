import { z } from "zod";
import { identifierSchema } from "./identifiers.js";
import { timestampSchema } from "./time.js";

/**
 * User boundary contracts.
 *
 * A User is who someone is in the product. The Identity that proves who they
 * are is a separate thing, and nothing here exposes it: an email address is an
 * authentication detail, not part of a profile.
 */

/**
 * A handle, as typed.
 *
 * Validated here only for shape and length. Whether a particular handle is
 * available, reserved, or already held is a question for the server, and one a
 * client cannot answer.
 */
export const handleSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(
    /^[a-zA-Z0-9_]+$/,
    "A handle may contain letters, numbers, and underscores, and nothing else",
  );

export type Handle = z.infer<typeof handleSchema>;

/** A display name. Not unique, and not an identifier. */
export const displayNameSchema = z.string().trim().min(1).max(80);

/**
 * A calendar date, as `YYYY-MM-DD`.
 *
 * Not a timestamp: a birthdate is a date everywhere rather than a moment
 * somewhere, and attaching a time to it would make the same person old enough
 * in one time zone and not another.
 */
export const calendarDateSchema = z.iso.date();

export type CalendarDate = z.infer<typeof calendarDateSchema>;

/**
 * Completing account creation.
 *
 * The date of birth is required because a minimum account age cannot be
 * enforced without it. It is restricted data: it never appears in a public
 * profile, and it is never written to event history.
 */
export const createUserRequestSchema = z.object({
  handle: handleSchema,
  displayName: displayNameSchema,
  biography: z.string().max(500).optional(),
  dateOfBirth: calendarDateSchema,
});

export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/**
 * Changing profile presentation.
 *
 * The handle is deliberately absent: changing it has consequences a profile
 * edit does not, so it has its own request and its own endpoint.
 */
export const updateProfileRequestSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    biography: z.string().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/** Changing a handle. */
export const updateHandleRequestSchema = z.object({ handle: handleSchema });

export type UpdateHandleRequest = z.infer<typeof updateHandleRequestSchema>;

/**
 * Preferences a person controls.
 *
 * Every field is optional on update, and absent means "leave as it is" rather
 * than "reset to default".
 */
export const preferencesSchema = z.object({
  autoplayVideos: z.boolean(),
  autoplaySound: z.boolean(),
  /** BCP 47. Null follows the device, which is not the same as any value. */
  locale: z.string().max(35).nullable(),
  /** IANA time zone. Null follows the device. */
  timeZone: z.string().max(64).nullable(),
  reducedMotion: z.boolean(),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export const updatePreferencesRequestSchema = preferencesSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one preference to update",
  });

export type UpdatePreferencesRequest = z.infer<typeof updatePreferencesRequestSchema>;

/**
 * A User as anyone may see them.
 *
 * Carries nothing about authentication, and nothing about a person that they
 * have not chosen to present.
 */
export const publicUserSchema = z.object({
  userId: identifierSchema,
  handle: handleSchema,
  displayName: displayNameSchema,
  biography: z.string().nullable(),
  createdAt: timestampSchema,
});

export type PublicUser = z.infer<typeof publicUserSchema>;

/**
 * A User as they see themselves.
 *
 * Includes the date of birth, because someone is entitled to see what is held
 * about them. Nobody else ever receives it.
 */
export const currentUserSchema = publicUserSchema.extend({
  status: z.enum(["active", "deactivated"]),
  dateOfBirth: calendarDateSchema,
  preferences: preferencesSchema,
});

export type CurrentUser = z.infer<typeof currentUserSchema>;
