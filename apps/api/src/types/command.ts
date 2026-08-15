import type { RequestContext } from "./request-context.js";

/**
 * An intention to change authoritative state.
 *
 * A command may be rejected; an event may not. The two are deliberately
 * different shapes so that "someone asked for this" is never mistaken in code
 * for "this happened".
 */
export interface Command<Type extends string = string, Payload = unknown> {
  readonly type: Type;
  readonly payload: Payload;
}

/**
 * Handles one command type.
 *
 * Handlers receive context explicitly and return a result. Authorization,
 * domain invariants, and persistence happen inside; transport concerns do not
 * reach here.
 */
export type CommandHandler<C extends Command, Result = void> = (
  command: C,
  context: RequestContext,
) => Promise<Result>;
