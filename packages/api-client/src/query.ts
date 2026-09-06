import type { z } from "zod";

/**
 * Turning what a caller asked for into a query string.
 *
 * Nothing paged, filtered or searched works without this, and it was the largest
 * hole in the transport: a client that cannot send `?limit=50&cursor=…` cannot
 * read a second page of anything.
 *
 * **The request is parsed before it is serialised, and that ordering is the
 * point.** Every list request in `packages/contracts` carries its own bounds —
 * `limit` capped at 100 for Moments, 50 for search, `cursor` capped at 200 or
 * 500 characters — and parsing applies them here rather than discovering them as
 * a 400. It also applies the *defaults*, so a caller who omits `limit` sends the
 * same request the server would have assumed, which makes a page size visible in
 * a log rather than implied by its absence.
 *
 * **Serialisation is deliberately narrow.** No nested objects, no bracket
 * notation, no comma-joined arrays: those are conventions a server has to be
 * taught, and this API's query schemas are flat by construction. A value this
 * cannot represent is a schema that changed shape, and it should fail here
 * rather than be encoded in a way the server reads as something else.
 */

/**
 * Serialise a request object into a query string.
 *
 * @param schema - The contract schema describing the request. Its bounds and
 *   defaults are applied before anything is written.
 * @param request - What the caller asked for.
 * @returns The query string including its leading `?`, or an empty string when
 *   nothing survived — so a caller can append it to a path unconditionally
 *   without producing a trailing `?`.
 * @throws {z.ZodError} If the request is outside what the contract permits. A
 *   page size the server would refuse is refused here, where the error names the
 *   field rather than arriving as a status code.
 * @throws {TypeError} If a parsed value is not a primitive or an array of
 *   primitives, which means the schema grew a shape this cannot encode.
 */
export function queryString<Schema extends z.ZodType>(
  schema: Schema,
  request: unknown,
): string {
  const parsed = schema.parse(request) as Record<string, unknown>;
  const parameters = new URLSearchParams();

  for (const [key, value] of Object.entries(parsed)) {
    // Absent rather than empty. `?cursor=` is a cursor the server must decode
    // and refuse; omitting it is the beginning of the list.
    if (value === undefined || value === null) {
      continue;
    }

    for (const one of Array.isArray(value) ? value : [value]) {
      parameters.append(key, encode(key, one));
    }
  }

  const query = parameters.toString();

  return query === "" ? "" : `?${query}`;
}

/**
 * One value, as the server reads it.
 *
 * @param key - Which field, so a refusal says which one.
 * @param value - The parsed value.
 * @returns Its wire form. Dates are ISO-8601 with milliseconds, matching
 *   `timestampSchema`; booleans and numbers are their obvious spellings.
 * @throws {TypeError} If it is not a value a query string can carry.
 */
function encode(key: string, value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  // Not `toString()`, which is locale- and platform-dependent. The contracts
  // spell a timestamp one way and this is it.
  if (value instanceof Date) {
    return value.toISOString();
  }

  throw new TypeError(`Cannot put ${key} in a query string: it is ${typeof value}`);
}
