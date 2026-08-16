/**
 * The Uploads feature's public surface.
 *
 * Everything else is internal. The server needs the routes; later phases need
 * to ask whether an upload is usable before a Moment may reference it.
 */
export { uploadRoutes } from "./routes/upload.routes.js";
export { handleGetUploadById } from "./queries/get-upload-by-id.handler.js";
export type { UploadDependencies } from "./dependencies.js";
