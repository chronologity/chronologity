import type { LinkingOptions } from "@react-navigation/native";
import type { MainRoutes } from "../../types/navigation";

/**
 * Links from outside the application, and what they are permitted to mean.
 *
 * **A deep link is a pointer, never a permission.** `privacy.md:432-442` puts
 * it as an equation — knowledge of an identifier is not authorization — and
 * `notifications.md:469-479` requires every destination to be reauthorized when
 * opened. Nothing here grants access to anything. It decides which links reach
 * the application at all, and what route they name; whether the person may see
 * what is there is answered by the server, every time, on arrival.
 *
 * **A link is untrusted input** (`security.md:1673-1681`), so the identifier in
 * it is validated before it becomes a route. That is not a security control —
 * the server is — but a malformed identifier should fail here, where it is a
 * link that does not open, rather than travel onwards as a request nobody meant
 * to make.
 *
 * Only the signed-in routes are listed. A link arriving while signed out is not
 * lost: the root navigator is showing the other tree, and React Navigation
 * holds the pending route until this one mounts.
 */

/** The identifier form the API issues. Anything else is not one of ours. */
const IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Whether a path segment is an identifier this application would have issued.
 *
 * @param value - The segment taken from the link.
 * @returns Whether it is well formed. Says nothing about whether it exists, or
 *   whether the reader may see it — both are the server's to answer.
 */
export function isIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

/**
 * Turn a link's Moment segment into a route parameter.
 *
 * @param value - The raw segment.
 * @returns The identifier, or undefined when it is not one — which leaves the
 *   route without its parameter and the screen showing that it cannot open,
 *   rather than asking the server about something arbitrary.
 */
export function parseMomentId(value: string): string | undefined {
  const decoded = decodeURIComponent(value);

  return isIdentifier(decoded) ? decoded : undefined;
}

/** The scheme and routes this application answers to. */
export const linking: LinkingOptions<MainRoutes> = {
  prefixes: ["chronologity://"],
  config: {
    screens: {
      timeline: "timeline",
      moment: {
        path: "moment/:momentId",
        parse: { momentId: parseMomentId as (value: string) => string },
      },
    },
  },
};
