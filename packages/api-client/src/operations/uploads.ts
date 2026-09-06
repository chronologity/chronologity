import {
  embeddedPlaceSuggestionsSchema,
  listUploadsRequestSchema,
  registerUploadRequestSchema,
  uploadAuthorizationSchema,
  uploadListSchema,
  uploadSchema,
} from "@chronologity/contracts";
import { z } from "zod";
import { defineOperation } from "./operation.js";

/**
 * Media, which never travels through the API.
 *
 * Three steps, and the middle one is not here: `registerUpload` authorises,
 * `putUpload` in `../uploads.js` writes the bytes straight to storage, and
 * `finalizeUpload` asks the server to open what arrived.
 *
 * **Nothing may be attached to a Moment until the state is `ready`.** `received`
 * means the bytes are there and the size checked; it does not mean anything has
 * looked inside the file. There is no webhook, so a client polls `getUpload` —
 * how often is a decision for whoever is showing the progress.
 */

/** Authorise an upload. Returns where to write and how long that permission lasts. */
export const registerUpload = defineOperation({
  method: "POST",
  template: "/uploads",
  body: registerUploadRequestSchema,
  response: uploadAuthorizationSchema,
});

/**
 * Tell the server the bytes have arrived.
 *
 * **Idempotent, and the API documents it so** — calling it on an upload already
 * received or ready returns rather than refusing. That is what makes it the one
 * `POST` in this package safe to retry automatically, which matters because it
 * is the call most likely to be interrupted: it comes straight after a transfer
 * that may have taken a minute on a bad connection.
 */
export const finalizeUpload = defineOperation({
  method: "POST",
  template: "/uploads/:uploadId/finalize",
  path: (args: { params: { uploadId: string } }) => `/uploads/${args.params.uploadId}/finalize`,
  response: uploadSchema,
  idempotent: true,
});

/** What this upload is now, including why it failed if it did. */
export const getUpload = defineOperation({
  method: "GET",
  template: "/uploads/:uploadId",
  path: (args: { params: { uploadId: string } }) => `/uploads/${args.params.uploadId}`,
  response: uploadSchema,
});

/** Uploads this account has registered. */
export const listUploads = defineOperation({
  method: "GET",
  template: "/uploads",
  query: listUploadsRequestSchema,
  response: uploadListSchema,
});

/**
 * Places suggested by what was embedded in the file.
 *
 * Mounted only where the API was built with a places service, so a client must
 * tolerate its absence rather than assuming a 404 means this upload has none.
 */
export const getUploadPlaces = defineOperation({
  method: "GET",
  template: "/uploads/:uploadId/places",
  path: (args: { params: { uploadId: string } }) => `/uploads/${args.params.uploadId}/places`,
  response: embeddedPlaceSuggestionsSchema,
});

/** Discard an upload. */
export const deleteUpload = defineOperation({
  method: "DELETE",
  template: "/uploads/:uploadId",
  path: (args: { params: { uploadId: string } }) => `/uploads/${args.params.uploadId}`,
  response: z.null(),
});
