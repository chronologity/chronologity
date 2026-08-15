import { ValidationError } from "../errors/validation-error.js";

/**
 * Stream naming.
 *
 * EventStoreDB treats the text before the first hyphen as a category, and its
 * built-in category projections depend on that. Names are therefore
 * `<category>-<aggregateId>`, which makes `$ce-moment` a usable stream of every
 * Moment event without maintaining an index ourselves.
 *
 * This helper enforces safe formatting only. What a category means, and which
 * identifier is the aggregate's, belong to the feature that owns the domain.
 *
 * A stream name is infrastructure. It never appears in a public identifier, and
 * nothing outside the write side should parse one.
 */

/** Lowercase, hyphen-free category: hyphens are the category separator. */
const CATEGORY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Conservative: identifiers are UUIDs today, and anything exotic is a mistake.
 *
 * Hyphens are permitted because UUIDs contain them — which is exactly why
 * `parseStreamName` splits on the first hyphen only.
 */
const AGGREGATE_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

export function streamName(category: string, aggregateId: string): string {
  if (!CATEGORY_PATTERN.test(category)) {
    throw new ValidationError(
      `Invalid stream category: categories are lowercase and may not contain hyphens`,
      { category },
    );
  }

  if (!AGGREGATE_ID_PATTERN.test(aggregateId)) {
    throw new ValidationError(`Invalid aggregate identifier for a stream name`, { aggregateId });
  }

  return `${category}-${aggregateId}`;
}

/** The category projection stream for a category, e.g. `$ce-moment`. */
export function categoryStream(category: string): string {
  if (!CATEGORY_PATTERN.test(category)) {
    throw new ValidationError(`Invalid stream category`, { category });
  }

  return `$ce-${category}`;
}

/**
 * Split a stream name back into its parts.
 *
 * Only the first hyphen separates: an aggregate identifier may contain
 * hyphens, and a UUID always does.
 */
export function parseStreamName(name: string): { category: string; aggregateId: string } {
  const separator = name.indexOf("-");

  if (separator <= 0 || separator === name.length - 1) {
    throw new ValidationError(`Malformed stream name`, { streamName: name });
  }

  return {
    category: name.slice(0, separator),
    aggregateId: name.slice(separator + 1),
  };
}

/**
 * Parse a stream name, or return undefined if it does not follow the convention.
 *
 * `$all` contains every stream the database has ever seen, including ones
 * written by other tools, by tests, or under an older convention. Anything
 * reading `$all` must be able to ignore what it does not recognise: a single
 * unparseable name should not be able to halt publication forever.
 */
export function tryParseStreamName(
  name: string,
): { category: string; aggregateId: string } | undefined {
  try {
    return parseStreamName(name);
  } catch {
    return undefined;
  }
}
