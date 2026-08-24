import { randomUUID } from "node:crypto";
import type {
  AssertMomentRelationshipRequest,
  MomentRelationship,
  MomentRelationshipList,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { withTransaction } from "../../lib/database/transaction.js";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import {
  checkRelationship,
  describeRelationshipRefusal,
  isCausal,
} from "./moment-relationship.policy.js";
import type { MomentRelationshipRepository } from "./moment-relationship.repository.js";
import type { MomentService } from "./moment.service.js";

/**
 * Claims connecting one Moment to another.
 *
 * Nothing here derives a relationship. `causality.md:103` is the rule the whole
 * feature exists to honour — Chronologity knows only that one Moment preceded
 * another — so every relationship is something a person said, recorded with who
 * said it.
 *
 * Kept apart from `MomentService`, which is long enough, and which owns a
 * different question: that one decides what a Moment is and who may see it,
 * this one decides what may be claimed about two of them.
 */
export class MomentRelationshipService {
  /** How many relationships one read returns. Bounded, like every list here. */
  private static readonly LIST_LIMIT = 100;

  /**
   * Build the relationship service.
   *
   * @param dataSource - Opens the transactions this service's writes commit in.
   * @param relationships - Where claims are stored.
   * @param moments - Proves each end is a Moment this Viewer may see. Reused
   *   rather than reimplemented: `get` already refuses an inaccessible Moment
   *   exactly as needed, and a second copy of that rule would eventually
   *   disagree with the first.
   * @param clock - Injected so tests can move time without waiting.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly relationships: MomentRelationshipRepository,
    private readonly moments: MomentService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Claim a relationship between two Moments.
   *
   * @param sourceMomentId - The Moment the claim starts from.
   * @param asserterUserId - Who is claiming.
   * @param request - Which Moment it points at, and what is being claimed.
   * @returns The claim as recorded. Asserting one that already exists returns
   *   the existing claim rather than failing: the caller asked for a state that
   *   already holds.
   * @throws {NotFoundError} If either Moment does not exist or this Viewer may
   *   not see it. The two are indistinguishable, because naming a Moment
   *   somebody cannot see would disclose that it exists.
   * @throws {ValidationError} If the claim is incoherent — a Moment related to
   *   itself, neither end the claimant's own, a cause after its effect, or a
   *   causal claim already running the other way.
   */
  async assert(
    sourceMomentId: string,
    asserterUserId: string,
    request: AssertMomentRelationshipRequest,
  ): Promise<MomentRelationship> {
    // Both ends proven visible before anything else is considered, so a refusal
    // never reveals something about a Moment the caller may not see.
    const source = await this.moments.get(sourceMomentId, asserterUserId);
    const target = await this.moments.get(request.targetMomentId, asserterUserId);

    const refusal = checkRelationship(sourceMomentId, request.targetMomentId, request.kind, {
      asserterUserId,
      sourceAuthorUserId: source.authorUserId,
      targetAuthorUserId: target.authorUserId,
      sourceOccurrence: source.occurrence,
      targetOccurrence: target.occurrence,
      // Only asked where it can matter. A contextual claim has no direction for
      // a reciprocal one to contradict.
      reciprocalCausalExists: isCausal(request.kind)
        ? await this.relationships.causalClaimExists(request.targetMomentId, sourceMomentId)
        : false,
    });

    if (refusal !== undefined) {
      throw new ValidationError(describeRelationshipRefusal(refusal), { field: "kind" });
    }

    const relationshipId = randomUUID();

    const recorded = await withTransaction(this.dataSource, (tx) =>
      this.relationships.assert(tx, {
        relationshipId,
        sourceMomentId,
        targetMomentId: request.targetMomentId,
        kind: request.kind,
        assertedByUserId: asserterUserId,
        createdAt: this.clock(),
      }),
    );

    if (recorded) {
      return {
        relationshipId,
        sourceMomentId,
        targetMomentId: request.targetMomentId,
        kind: request.kind,
        origin: "asserted",
        assertedByUserId: asserterUserId,
        createdAt: this.clock().toISOString(),
      };
    }

    // The claim was already there. For a symmetric kind that includes the same
    // claim made the other way round, which is one relationship however it was
    // typed.
    const existing = (await this.list(sourceMomentId, asserterUserId)).relationships.find(
      (relationship) =>
        relationship.kind === request.kind &&
        (relationship.sourceMomentId === request.targetMomentId ||
          relationship.targetMomentId === request.targetMomentId),
    );

    if (existing === undefined) {
      throw new Error("A relationship neither recorded nor found");
    }

    return existing;
  }

  /**
   * Read a Moment's claims, in both directions.
   *
   * @param momentId - Whose claims.
   * @param viewerUserId - Who is asking.
   * @returns The claims whose far end this Viewer may also see. A relationship
   *   pointing at something inaccessible is omitted entirely rather than
   *   returned with the identifier blanked: the identifier is itself the
   *   disclosure (`privacy.md:158`).
   * @throws {NotFoundError} If there is no such Moment, or this Viewer may not
   *   see it.
   */
  async list(momentId: string, viewerUserId: string): Promise<MomentRelationshipList> {
    await this.moments.get(momentId, viewerUserId);

    return {
      relationships: await this.relationships.findForMoment(
        momentId,
        viewerUserId,
        MomentRelationshipService.LIST_LIMIT,
      ),
    };
  }

  /**
   * Withdraw a claim.
   *
   * @param relationshipId - Which claim.
   * @param asserterUserId - Who is withdrawing. Only whoever made a claim may
   *   withdraw it: it is their reading of history, and neither Moment's author
   *   owns it on their behalf.
   * @returns Nothing. Withdrawing leaves both Moments exactly as they were,
   *   occurrence included (`causality.md` invariants 14 and 15).
   * @throws {NotFoundError} If there is no such claim, or it was not theirs to
   *   withdraw.
   */
  async withdraw(relationshipId: string, asserterUserId: string): Promise<void> {
    const withdrawn = await withTransaction(this.dataSource, (tx) =>
      this.relationships.withdraw(tx, relationshipId, asserterUserId),
    );

    if (!withdrawn) {
      throw new NotFoundError("No such relationship");
    }
  }
}
