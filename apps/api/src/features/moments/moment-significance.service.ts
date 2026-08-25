import type { PersonalSignificance } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import type { MomentSignificanceRepository } from "./moment-significance.repository.js";
import type { MomentService } from "./moment.service.js";

/**
 * Saying that a Moment matters to you.
 *
 * The only part of significance a person touches. Everything else is derived
 * from the shape of history by a worker, and nothing derived is exposed —
 * invariant 37 says Chronologity should not initially show a universal
 * significance score, and nothing needs one until temporal zoom chooses what to
 * display.
 *
 * A mark is private, always. There is no shape here that could return somebody
 * else's, which is the strongest form that guarantee can take.
 */
export class MomentSignificanceService {
  /**
   * Build the significance service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param significance - Where marks are stored.
   * @param moments - Proves the Moment is one this Viewer may see. A mark on
   *   history somebody cannot reach would be a mark on nothing.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly significance: MomentSignificanceRepository,
    private readonly moments: MomentService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Say a Moment matters to you.
   *
   * Anybody may mark any Moment they can see, including one somebody else
   * recorded: the last photograph of a loved one may have been taken by a
   * sibling, and it is no less the Moment that matters most. Two people marking
   * one Moment is not a conflict — each mark lives in that person's own scope.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Who says so.
   * @returns Their own mark.
   * @throws {NotFoundError} If there is no such Moment or they may not see it.
   */
  async mark(momentId: string, viewerUserId: string): Promise<PersonalSignificance> {
    await this.moments.get(momentId, viewerUserId);

    await withTransaction(this.dataSource, (tx) =>
      this.significance.mark(tx, momentId, viewerUserId, this.clock()),
    );

    return this.read(momentId, viewerUserId);
  }

  /**
   * Take your mark back.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Whose mark.
   * @returns Their own mark, now absent. Unmarking one never marked is the state
   *   they asked for, not an error.
   * @throws {NotFoundError} If there is no such Moment or they may not see it.
   */
  async unmark(momentId: string, viewerUserId: string): Promise<PersonalSignificance> {
    await this.moments.get(momentId, viewerUserId);

    await withTransaction(this.dataSource, (tx) =>
      this.significance.unmark(tx, momentId, viewerUserId),
    );

    return this.read(momentId, viewerUserId);
  }

  /**
   * Read your own mark.
   *
   * @param momentId - Which Moment.
   * @param viewerUserId - Whose mark. Always the caller.
   * @returns Whether they marked it, and when. Never whether anybody else did:
   *   which Moments matter to somebody is closer to a diary than to a reaction.
   * @throws {NotFoundError} If there is no such Moment or they may not see it.
   */
  async read(momentId: string, viewerUserId: string): Promise<PersonalSignificance> {
    await this.moments.get(momentId, viewerUserId);

    const markedAt = await this.significance.markedAt(momentId, viewerUserId);

    return {
      momentId,
      significant: markedAt !== undefined,
      markedAt: markedAt?.toISOString() ?? null,
    };
  }
}
