/**
 * What a profile change actually changes.
 *
 * Pure, and worth stating separately because the interesting part is a
 * distinction that is easy to collapse: a biography of null clears it, while
 * undefined leaves it alone. Treating the two the same would make it
 * impossible to remove a biography — the field would only ever be settable.
 */

/** A profile as it currently stands. */
export interface CurrentProfile {
  readonly displayName: string;
  readonly biography: string | null;
}

/** A requested change. Undefined means "leave this alone". */
export interface ProfileChange {
  readonly displayName?: string | undefined;
  /** Null clears the biography; undefined leaves it as it is. */
  readonly biography?: string | null | undefined;
}

/**
 * Work out which fields a request would actually alter.
 *
 * @param current - The profile as stored.
 * @param requested - What was asked for.
 * @returns Only the fields that would change. An empty object means the
 *   request would alter nothing — someone saved a form without editing it —
 *   which the caller refuses rather than recording.
 */
export function profileChanges(current: CurrentProfile, requested: ProfileChange): ProfileChange {
  const changes: { displayName?: string; biography?: string | null } = {};

  if (requested.displayName !== undefined && requested.displayName !== current.displayName) {
    changes.displayName = requested.displayName;
  }

  // Compared with `!==` against the stored value, so clearing a biography that
  // is already absent counts as no change, while clearing one that exists is a
  // real one.
  if (requested.biography !== undefined && (requested.biography ?? null) !== current.biography) {
    changes.biography = requested.biography ?? null;
  }

  return changes;
}

/**
 * Whether a set of changes would alter anything.
 *
 * @param changes - As returned by {@link profileChanges}.
 * @returns True when nothing would change.
 */
export function changesNothing(changes: ProfileChange): boolean {
  return Object.keys(changes).length === 0;
}

/**
 * Whether taking this handle is a real change.
 *
 * @param current - The handle held now, as chosen.
 * @param requested - The handle being taken, as chosen.
 * @returns True if it differs. Compared in the form the person chose rather
 *   than the normalised form, because changing only capitalisation is a real
 *   change and is allowed: `@richard` to `@Richard` alters how somebody is
 *   presented, which is the whole purpose of a handle.
 */
export function isHandleChange(current: string, requested: string): boolean {
  return current !== requested;
}
