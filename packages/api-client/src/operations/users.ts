import {
  confirmExportRequestSchema,
  createUserRequestSchema,
  currentUserSchema,
  exportStatusSchema,
  publicUserSchema,
  updateHandleRequestSchema,
  updatePreferencesRequestSchema,
  updateProfileRequestSchema,
} from "@chronologity/contracts";
import { z } from "zod";
import { defineOperation } from "./operation.js";

/**
 * The account somebody chooses to present, and leaving.
 *
 * **An Identity and a User are different things**, and the gap between them is
 * why `createAccount` exists: signing in produces a Session, and until an account
 * is created behind it every read of history refuses with `ONBOARDING_REQUIRED`
 * rather than an authentication failure. A client that treats that code as
 * "signed out" sends somebody back to a sign-in they have already completed.
 *
 * Deactivating, deleting and exporting are all two-step: the first call sends a
 * confirmation, the second acts on its token. Nothing here is undone by asking
 * again.
 */

/** Create the account behind a Session. */
export const createAccount = defineOperation({
  method: "POST",
  template: "/users",
  body: createUserRequestSchema,
  response: currentUserSchema,
});

/** Everything this account knows about itself. */
export const getCurrentUser = defineOperation({
  method: "GET",
  template: "/users/me",
  response: currentUserSchema,
});

/** Change the display name or biography. */
export const updateProfile = defineOperation({
  method: "PATCH",
  template: "/users/me",
  body: updateProfileRequestSchema,
  response: currentUserSchema,
});

/** Take a different handle. The old one is released after a cooldown. */
export const updateHandle = defineOperation({
  method: "PUT",
  template: "/users/me/handle",
  body: updateHandleRequestSchema,
  response: currentUserSchema,
});

/** Change what this account prefers. */
export const updatePreferences = defineOperation({
  method: "PUT",
  template: "/users/me/preferences",
  body: updatePreferencesRequestSchema,
  response: currentUserSchema,
});

/** Hide the account without deleting it. Reversible by signing in again. */
export const deactivateAccount = defineOperation({
  method: "POST",
  template: "/users/me/deactivate",
  response: z.object({ sessionsRevoked: z.number().int().min(0) }),
});

/** Undo a deactivation. */
export const reactivateAccount = defineOperation({
  method: "POST",
  template: "/users/me/reactivate",
  response: currentUserSchema,
});

/** Ask for the account to be deleted. Sends a confirmation link. */
export const requestAccountDeletion = defineOperation({
  method: "POST",
  template: "/users/me/deletion",
  response: z.null(),
});

/** Confirm deletion from the link's token. Everything stops working at once. */
export const confirmAccountDeletion = defineOperation({
  method: "POST",
  template: "/users/me/deletion/confirmation",
  body: z.object({ token: z.string().min(1).max(512) }),
  response: z.null(),
});

/** Ask for a copy of everything. Sends a confirmation link. */
export const requestExport = defineOperation({
  method: "POST",
  template: "/users/me/export",
  response: z.null(),
});

/** Confirm an export from the link's token. */
export const confirmExport = defineOperation({
  method: "POST",
  template: "/users/me/export/confirmation",
  body: confirmExportRequestSchema,
  response: z.null(),
});

/** How an export is progressing, and where to collect it. */
export const getExport = defineOperation({
  method: "GET",
  template: "/users/me/export",
  response: exportStatusSchema,
});

/** Somebody else's public profile, by handle. */
export const getUserByHandle = defineOperation({
  method: "GET",
  template: "/users/:handle",
  path: (args: { params: { handle: string } }) => `/users/${args.params.handle}`,
  response: publicUserSchema,
});
