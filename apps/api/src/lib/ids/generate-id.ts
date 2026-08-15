import { randomUUID } from "node:crypto";

/** Generate a Chronologity identifier. Identifiers are UUIDs in serialized form. */
export function generateId(): string {
  return randomUUID();
}
