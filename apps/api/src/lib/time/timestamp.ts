/** Serialize an instant to ISO-8601 with an explicit offset, as the contracts require. */
export function toTimestamp(value: Date): string {
  return value.toISOString();
}
