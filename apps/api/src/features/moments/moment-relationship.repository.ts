import type { MomentRelationship as MomentRelationshipContract } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import type { Transaction } from "../../lib/database/transaction.js";
import { MomentRelationship } from "./moment-relationship.model.js";
import { Moment as MomentRow } from "./moment.model.js";
import { moderationPermits, privacyPermits } from "./moment.repository.js";

/**
 * Shape a stored relationship as the contract.
 *
 * @param row - As read from `moment_relationships`.
 * @param unavailable - Whether moderation has withheld the far end from this
 *   Viewer, making the claim a tombstone: the link is still true and what it
 *   points at is not shown.
 * @returns The relationship. Carries no confidence score, deliberately
 *   (`causality.md:485`).
 */
function toRelationship(
  row: MomentRelationship,
  unavailable: boolean,
): MomentRelationshipContract {
  return {
    relationshipId: row.relationshipId,
    sourceMomentId: row.sourceMomentId,
    targetMomentId: row.targetMomentId,
    kind: row.kind as MomentRelationshipContract["kind"],
    origin: row.origin as MomentRelationshipContract["origin"],
    assertedByUserId: row.assertedByUserId,
    createdAt: row.createdAt.toISOString(),
    unavailable,
  };
}

/** Reads and writes claims connecting Moments. */
export class MomentRelationshipRepository {
  /**
   * Build the relationship repository.
   *
   * @param dataSource - Used for reads. Writes take a transaction of their own.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Record a claim.
   *
   * @param tx - The caller's transaction.
   * @param relationship - Everything established when it was asserted.
   * @returns Whether it was recorded. False means the same claim already
   *   exists — decided by the unique indexes rather than by a prior read, so
   *   two simultaneous assertions cannot both succeed. For a symmetric kind
   *   that includes the same claim made the other way round, which is one claim
   *   however it is typed.
   */
  async assert(
    tx: Transaction,
    relationship: {
      relationshipId: string;
      sourceMomentId: string;
      targetMomentId: string;
      kind: string;
      assertedByUserId: string;
      createdAt: Date;
    },
  ): Promise<boolean> {
    const inserted = await tx
      .createQueryBuilder()
      .insert()
      .into(MomentRelationship)
      .values({ ...relationship, origin: "asserted" })
      .orIgnore()
      // Explicit, and checked by length: `orIgnore` populates `identifiers`
      // whether or not a row was written, so the returned rows are the only
      // honest signal (ADR-102).
      .returning(["relationshipId"])
      .execute();

    return (inserted.raw as unknown[]).length > 0;
  }

  /**
   * Whether a causal claim already runs from one Moment to another.
   *
   * Asked in the direction opposite to the one being made, which is what
   * catches "A led to B" meeting "B led to A". That pair is incoherent whatever
   * the dates say, including when the dates are too coarse to order.
   *
   * @param sourceMomentId - The Moment a causal claim would run from.
   * @param targetMomentId - The Moment it would run to.
   * @returns Whether such a claim exists.
   */
  async causalClaimExists(sourceMomentId: string, targetMomentId: string): Promise<boolean> {
    return this.dataSource
      .getRepository(MomentRelationship)
      .createQueryBuilder("relationship")
      .where("relationship.source_moment_id = :sourceMomentId", { sourceMomentId })
      .andWhere("relationship.target_moment_id = :targetMomentId", { targetMomentId })
      .andWhere("relationship.kind IN ('led_to', 'contributed_to')")
      .getExists();
  }

  /**
   * Read one claim.
   *
   * @param relationshipId - Which claim.
   * @returns It, or undefined when there is no such claim.
   */
  async findById(relationshipId: string): Promise<MomentRelationshipContract | undefined> {
    const row = await this.dataSource
      .getRepository(MomentRelationship)
      .findOneBy({ relationshipId });

    // Read by the author of a claim to confirm what they just made, never as a
    // Viewer read, so there is no far end being withheld from anybody here.
    return row === null ? undefined : toRelationship(row, false);
  }

  /**
   * Read a Moment's claims, in both directions.
   *
   * A relationship is only listed when the Viewer may see the Moment at the far
   * end. `privacy.md:158` requires that Chronologity "never use a visible
   * relationship to reveal an inaccessible Moment" — and a relationship naming
   * an identifier is itself a disclosure that something exists there.
   *
   * Filtered in SQL rather than afterwards, through the same predicate every
   * other viewer-aware read uses.
   *
   * @param momentId - Whose claims. The Viewer's access to this end is the
   *   caller's business, and is proven before this is called.
   * @param viewerUserId - Who is asking.
   * @param viewerIsAdult - Whether the Viewer is old enough for age-restricted
   *   content, which decides whether such a far end reads as a tombstone.
   * @param limit - How many at most.
   * @returns The claims, newest first.
   */
  async findForMoment(
    momentId: string,
    viewerUserId: string,
    viewerIsAdult: boolean,
    limit: number,
  ): Promise<MomentRelationshipContract[]> {
    // Two conditions rather than one, because the two ways a far end can be
    // out of reach call for opposite treatment. Privacy withholding it removes
    // the claim from the list entirely: `privacy.md:158` forbids using a
    // visible relationship to reveal an inaccessible Moment. Moderation
    // withholding it leaves a tombstone, because the chain of
    // `moderation.md:713` should keep its shape and because Chronologity
    // admitting its own act discloses nothing about anybody else.
    const rows: { relationship: MomentRelationship; unavailable: boolean }[] =
      await this.dataSource
        .getRepository(MomentRelationship)
        .createQueryBuilder("relationship")
        // The far end, whichever end that is.
        .innerJoin(
          MomentRow,
          "other",
          `other.moment_id = CASE
             WHEN relationship.source_moment_id = :momentId THEN relationship.target_moment_id
             ELSE relationship.source_moment_id
           END`,
        )
        .addSelect(`NOT ${moderationPermits("other")}`, "unavailable")
        .where(
          "(relationship.source_moment_id = :momentId OR relationship.target_moment_id = :momentId)",
          { momentId },
        )
        .andWhere("other.deleted_at IS NULL")
        .andWhere(privacyPermits("other"), { viewerUserId })
        .setParameter("viewerIsAdult", viewerIsAdult)
        .orderBy("relationship.created_at", "DESC")
        .addOrderBy("relationship.relationship_id", "DESC")
        .take(limit)
        .getRawAndEntities()
        .then((result) =>
          result.entities.map((relationship, index) => ({
            relationship,
            unavailable: result.raw[index]?.unavailable === true,
          })),
        );

    return rows.map((row) => toRelationship(row.relationship, row.unavailable));
  }

  /**
   * Withdraw a claim.
   *
   * @param tx - The caller's transaction.
   * @param relationshipId - Which claim.
   * @param assertedByUserId - Who is withdrawing. Only whoever made a claim may
   *   withdraw it; it is their reading of history, not either author's.
   * @returns Whether one was withdrawn. Removing a claim never touches either
   *   Moment (`causality.md` invariant 14).
   */
  async withdraw(
    tx: Transaction,
    relationshipId: string,
    assertedByUserId: string,
  ): Promise<boolean> {
    const { affected } = await tx.delete(MomentRelationship, {
      relationshipId,
      assertedByUserId,
    });

    return (affected ?? 0) > 0;
  }
}
