import type { EventStoreDBClient } from "@eventstore/db-client";
import type pg from "pg";
import type { UploadLimits } from "../../config/storage-config.js";
import type { DerivativeClient } from "../../integrations/metadata/derivative-client.js";
import type { MetadataClient } from "../../integrations/metadata/metadata-client.js";
import type { StorageClient } from "../../integrations/storage/storage-client.js";
import type { Logger } from "../../lib/logger/logger.js";

/**
 * What Upload handlers need from the outside world.
 *
 * Passed to each handler rather than resolved from a container, so a handler's
 * dependencies are visible in its signature.
 */
export interface UploadDependencies {
  readonly client: EventStoreDBClient;
  readonly pool: pg.Pool;
  readonly storage: StorageClient;
  /**
   * Reads what a file actually is.
   *
   * Only the checker needs it, so it is optional: the HTTP process authorises
   * and verifies uploads without ever opening one.
   */
  readonly metadata: MetadataClient;
  /**
   * Produces the files that make media showable.
   *
   * Only the checker needs it: authorising and verifying an upload never
   * transforms one.
   */
  readonly derivatives: DerivativeClient;
  readonly limits: UploadLimits;
  readonly logger?: Logger;
  /** Injected so tests can move time without waiting. */
  readonly clock?: () => Date;
}

/**
 * The clock a handler should use.
 *
 * @param deps - May carry an injected clock.
 * @returns The clock to read time from.
 */
export function clockFor(deps: UploadDependencies): () => Date {
  return deps.clock ?? (() => new Date());
}

/**
 * The size limit for a media kind.
 *
 * @param deps - Supplies the configured limits.
 * @param kind - Which kind of media.
 * @returns The maximum size in bytes. Video is larger than image because
 *   ninety seconds of video is inherently larger than a photograph, not
 *   because video is more privileged.
 */
export function maximumBytesFor(deps: UploadDependencies, kind: "image" | "video"): number {
  return kind === "video" ? deps.limits.maxVideoBytes : deps.limits.maxImageBytes;
}
