import type { DerivativeKind } from "@chronologity/contracts";
import type { DomainEvent } from "../../../types/domain-event.js";

/**
 * The files needed to show this media were produced.
 *
 * Recorded because what exists in storage should be answerable from history
 * rather than by listing a bucket. Derivatives themselves are not
 * authoritative — the original is kept and never altered, so any of these can
 * be produced again — but the fact that they were produced, and when, is part
 * of what happened to the upload.
 */
export type UploadDerivativesProduced = DomainEvent<
  "UploadDerivativesProduced",
  {
    derivatives: readonly DerivativeKind[];
    producedAt: string;
  }
>;
