import {
  buildSchema,
  GraphQLObjectType,
  TypeInfo,
  parse,
  visit,
  visitWithTypeInfo,
  type GraphQLSchema,
} from "graphql";
import { loadSchema } from "../graphql/load-schema.js";

/**
 * Every field a client can reach, so a matrix can be checked for holes.
 *
 * **The point is not the list, it is the failure.** Authorization here has been
 * tested since it was written — sixteen suites, and almost every case the
 * canonical matrix names is already proven somewhere. What none of that could
 * answer is the only question worth asking of it, which
 * `apps/api/src/features/authorization/permission-matrix.integration.test.ts`
 * states plainly: "what is not covered."
 *
 * That application answers it by scanning its route declarations out of source
 * and refusing to let a new guarded route be neither exercised nor exempted.
 * This is the same idea against a different surface. A REST service adds a
 * route; a GraphQL service adds a *field*, and a field is reachable the moment
 * it is declared — there is no registration step somebody could forget, which
 * makes an unwatched field easier to add here than there, not harder.
 *
 * Read from the built schema rather than from the SDL text, so a field that
 * exists only because a fragment or an interface put it there is still counted.
 */

/** A field somebody can select, named the way a matrix would refer to it. */
export interface ReachableField {
  /** The type it hangs off — `Query` for a root field. */
  readonly type: string;
  readonly field: string;
  /** `Type.field`, which is how coverage and exemptions name it. */
  readonly path: string;
}

/**
 * Types that carry no reachable data of their own.
 *
 * Connections, edges and page info are structure: their fields are cursors and
 * booleans about the page, and what they may contain is decided by whatever
 * produced the page rather than by them. Including them would make the matrix
 * mostly about `hasNextPage`.
 */
const STRUCTURAL = new Set([
  "PageInfo",
  "TimelineEdge",
  "TimelineConnection",
  "MediaEdge",
  "MediaConnection",
  "CommentEdge",
  "CommentConnection",
  "HistoricalContextEdge",
  "HistoricalContextConnection",
]);

/**
 * Every field reachable through the schema.
 *
 * @param schema - The schema to read. Defaults to this application's own.
 * @returns One entry per field on every object type a client can reach,
 *   excluding introspection and the structural page types above.
 */
export function reachableFields(schema: GraphQLSchema = buildSchema(loadSchema())): ReachableField[] {
  const found: ReachableField[] = [];

  for (const [name, type] of Object.entries(schema.getTypeMap())) {
    if (name.startsWith("__") || !(type instanceof GraphQLObjectType) || STRUCTURAL.has(name)) {
      continue;
    }

    for (const field of Object.keys(type.getFields())) {
      found.push({ type: name, field, path: `${name}.${field}` });
    }
  }

  return found;
}

/**
 * Which fields a document actually selects.
 *
 * **Derived from the document rather than declared beside it**, which is the
 * property that makes the completeness check worth having. A hand-written list
 * of "what this test covers" is a second thing to maintain and the first thing
 * to go stale — it would keep claiming coverage after somebody deleted the
 * selection that provided it.
 *
 * Resolved against the schema so a field is attributed to the type that declares
 * it: `momentId` on a Moment and `momentId` on a readable Timeline entry are two
 * fields, and a matrix that conflated them would report a hole as covered.
 *
 * @param document - The query text.
 * @param schema - The schema to resolve against. Defaults to this application's.
 * @returns The `Type.field` paths the document selects, including through
 *   fragments and inline spreads.
 * @throws {Error} If the document is not valid GraphQL.
 */
export function fieldsSelectedBy(
  document: string,
  schema: GraphQLSchema = buildSchema(loadSchema()),
): Set<string> {
  const selected = new Set<string>();
  const info = new TypeInfo(schema);

  visit(
    parse(document),
    visitWithTypeInfo(info, {
      Field(node) {
        const parent = info.getParentType();

        if (parent !== undefined && parent !== null) {
          selected.add(`${parent.name}.${node.name.value}`);
        }
      },
    }),
  );

  return selected;
}
