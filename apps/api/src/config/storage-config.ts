import type { Env } from "./env.js";

/**
 * Object storage and upload limits.
 *
 * The endpoint and credentials describe wherever media bytes live — SeaweedFS
 * locally, a cloud provider later. Nothing above `integrations/storage/`
 * depends on which, which is what makes that a configuration change rather
 * than a migration.
 */
export interface StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  /** Path-style addressing. AWS uses virtual-hosted style; most others do not. */
  readonly forcePathStyle: boolean;
  /** How long a presigned upload URL stays usable. */
  readonly uploadUrlTtlSeconds: number;
}

/**
 * Limits applied to a single uploaded file.
 *
 * Per-file and technical. A Moment may contain unlimited media at the product
 * level (`media.md:109`); these bound one object, not a collection.
 */
export interface UploadLimits {
  /** How long a registered upload may go unfinalized before it is refused. */
  readonly registrationTtlSeconds: number;
  readonly maxImageBytes: number;
  readonly maxVideoBytes: number;
}

/**
 * Derive object-storage settings from the environment.
 *
 * @param env - The validated environment.
 * @returns Where media bytes live and how uploads are authorised.
 */
export function toStorageConfig(env: Env): StorageConfig {
  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    bucket: env.S3_BUCKET,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    uploadUrlTtlSeconds: env.S3_UPLOAD_URL_TTL_SECONDS,
  };
}

/**
 * Derive per-file upload limits from the environment.
 *
 * @param env - The validated environment.
 * @returns The limits enforced when an upload is finalized.
 */
export function toUploadLimits(env: Env): UploadLimits {
  return {
    registrationTtlSeconds: env.UPLOAD_REGISTRATION_TTL_SECONDS,
    maxImageBytes: env.UPLOAD_MAX_IMAGE_BYTES,
    maxVideoBytes: env.UPLOAD_MAX_VIDEO_BYTES,
  };
}
