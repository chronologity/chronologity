import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { StorageConfig } from "../../config/storage-config.js";

/**
 * Object storage.
 *
 * An adapter, not a domain authority: it moves bytes and reports what it
 * finds, and decides nothing about whether an upload is acceptable. Local
 * development runs SeaweedFS in S3 mode; the production provider is a later
 * decision and does not change this interface.
 *
 * Media uploads never pass through the API (`media.md:184`). What crosses this
 * boundary is authorisation to write one object, and afterwards a question
 * about what actually arrived.
 */

/** What storage reports about an object that exists. */
export interface StoredObject {
  readonly byteSize: number;
  /** As recorded by storage. Set by the client at upload time, so not proof. */
  readonly contentType: string | undefined;
  /** Storage's own checksum. Useful for deduplication questions, not identity. */
  readonly entityTag: string | undefined;
}

export interface StorageClient {
  /**
   * How long a presigned URL this client issues remains valid.
   *
   * Exposed so callers can tell someone when their authorisation lapses
   * without reaching for the configuration the adapter was built from.
   */
  readonly uploadUrlTtlSeconds: number;
  /**
   * Authorise a single upload.
   *
   * @param key - The object to be written. Server-generated, never client-supplied.
   * @param contentType - Bound into the signature.
   * @returns A URL permitting one PUT to that key until it expires.
   */
  presignUpload(key: string, contentType: string): Promise<string>;
  /**
   * Authorise reading one object for a short while.
   *
   * Needed because the media checker does not hold storage credentials of its
   * own — it points a decoder at a URL, and the decoder asks for whichever
   * ranges of the file it needs.
   *
   * @param key - The object to read.
   * @param expiresInSeconds - How long the link works. Short by intent.
   * @returns A URL permitting reads of that one object until it expires.
   */
  presignDownload(key: string, expiresInSeconds?: number): Promise<string>;
  /**
   * Ask storage what is actually at a key.
   *
   * @param key - The object to inspect.
   * @returns What storage holds, or undefined if there is nothing there.
   */
  head(key: string): Promise<StoredObject | undefined>;
  /**
   * Remove an object.
   *
   * @param key - The object to remove.
   * @returns Nothing. Deleting something absent is not an error: the caller
   *   wants the object gone, and it is.
   */
  remove(key: string): Promise<void>;
  close(): void;
}

/**
 * Build the object-storage adapter.
 *
 * @param config - Endpoint, credentials, bucket, addressing style, and how long
 *   a presigned upload URL remains valid.
 * @returns A client that can authorise uploads, inspect objects, and delete them.
 */
export function createStorageClient(config: StorageConfig): StorageClient {
  const options: S3ClientConfig = {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };

  const client = new S3Client(options);

  return {
    uploadUrlTtlSeconds: config.uploadUrlTtlSeconds,

    async presignUpload(key, contentType) {
      // The content type is part of what is signed, so a client that uploads
      // something else invalidates its own authorisation. This is a cheap
      // check rather than a strong one — what the bytes actually are is
      // established at finalization, not here.
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: contentType,
      });

      return getSignedUrl(client, command, { expiresIn: config.uploadUrlTtlSeconds });
    },

    async presignDownload(key, expiresInSeconds = config.uploadUrlTtlSeconds) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },

    async head(key) {
      try {
        const response = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );

        return {
          byteSize: response.ContentLength ?? 0,
          contentType: response.ContentType,
          entityTag: response.ETag,
        };
      } catch (error) {
        // A missing object is an answer, not a failure: it is what "the client
        // said it uploaded but did not" looks like. Anything else is a real
        // storage problem and must not be swallowed into the same undefined.
        if (isNotFound(error)) {
          return undefined;
        }

        throw error;
      }
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },

    close() {
      client.destroy();
    },
  };
}

/**
 * Whether a storage error means the object is not there.
 *
 * @param error - Whatever the SDK threw.
 * @returns True for a 404 or a NotFound-shaped error. Checked structurally
 *   because the SDK reports a missing object as `NotFound` for HEAD and
 *   `NoSuchKey` for GET, and the distinction is not useful here.
 */
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const name = "name" in error ? error.name : undefined;
  const status =
    "$metadata" in error &&
    typeof error.$metadata === "object" &&
    error.$metadata !== null &&
    "httpStatusCode" in error.$metadata
      ? error.$metadata.httpStatusCode
      : undefined;

  return name === "NotFound" || name === "NoSuchKey" || status === 404;
}
