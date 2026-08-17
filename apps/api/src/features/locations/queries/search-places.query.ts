/** Look for places matching what someone typed. */
export interface SearchPlacesQuery {
  readonly query: string;
  readonly limit: number | undefined;
}
