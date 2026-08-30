import { randomBytes, randomUUID } from "node:crypto";
import type { ViewSpecification } from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import type { Cursor } from "../../lib/pagination/cursor.js";
import type { Transaction } from "../../lib/database/transaction.js";
import { SavedViewRow, SavedViewShareRow } from "./saved-view.model.js";

/**
 * Reading and writing Saved Views.
 *
 * Reads take the DataSource and writes take a transaction, as everywhere here.
 *
 * **Ownership is a predicate, never an assumption.** Every read and every write
 * carries `user_id` in its `WHERE`, so a service that forgot to check would
 * still find nothing rather than somebody else's view. Somebody else's row is
 * absent rather than forbidden, which is what stops identifiers being probed.
 */

/**
 * How long a share token is, in bytes before encoding.
 *
 * Thirty-two, because the token *is* the authorisation: it is the only thing
 * between a link somebody forwarded and the view behind it. Sized like a
 * session secret rather than like an identifier.
 */
const TOKEN_BYTES = 32;

/**
 * Reading and writing Saved Views and the links made to them.
 *
 * Ownership is a `WHERE user_id` predicate on every read and every write, so a
 * service that forgot to check would still find nothing rather than somebody
 * else's view.
 */
export class SavedViewRepository {
  /**
   * Build the repository.
   *
   * @param dataSource - Reads use this directly; writes take a transaction.
   */
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Keep a view.
   *
   * @param tx - The caller's transaction.
   * @param userId - Whose it is.
   * @param title - What they called it.
   * @param specification - The View Specification. Validated by the caller;
   *   what comes back out is validated again, because it may have been written
   *   by an older version of this system than the one reading it.
   * @param at - When.
   * @returns The new view's identifier.
   * @throws {Error} If the database refuses.
   */
  async save(
    tx: Transaction,
    userId: string,
    title: string,
    specification: ViewSpecification,
    at: Date,
  ): Promise<string> {
    const savedViewId = randomUUID();

    // Raw, because the specification is a free-form document and TypeORM's
    // deep-partial mapping tries to walk it as an entity. The repositories
    // beside this one write raw SQL for their own reasons; this is one more.
    await tx.query(
      `INSERT INTO saved_views
         (saved_view_id, user_id, title, specification, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $5)`,
      [savedViewId, userId, title, JSON.stringify(specification), at],
    );

    return savedViewId;
  }

  /**
   * Read one, if it belongs to this person.
   *
   * @param savedViewId - Which view.
   * @param userId - Who is asking.
   * @returns It, or undefined when there is no such view *of theirs* — the two
   *   cases are deliberately indistinguishable to the caller.
   * @throws {Error} If the database refuses.
   */
  async find(savedViewId: string, userId: string): Promise<SavedViewRow | undefined> {
    return (
      (await this.dataSource
        .getRepository(SavedViewRow)
        .findOne({ where: { savedViewId, userId } })) ?? undefined
    );
  }

  /**
   * Somebody's views, newest first.
   *
   * @param userId - Whose.
   * @param limit - How many at most.
   * @param after - Resume after this position.
   * @returns The page.
   * @throws {Error} If the database refuses.
   */
  async list(userId: string, limit: number, after?: Cursor): Promise<SavedViewRow[]> {
    const query = this.dataSource
      .getRepository(SavedViewRow)
      .createQueryBuilder("view")
      .where("view.user_id = :userId", { userId })
      .orderBy("view.created_at", "DESC")
      .addOrderBy("view.saved_view_id", "DESC")
      .take(limit);

    if (after !== undefined) {
      query.andWhere("(view.created_at, view.saved_view_id) < (:at, :id)", {
        at: after.at,
        id: after.id,
      });
    }

    return query.getMany();
  }

  /**
   * Rename one.
   *
   * The specification is not editable. A view that pointed somewhere else would
   * be a different view wearing an old name, and anybody holding a share of it
   * would silently be given something they were never shown.
   *
   * @param tx - The caller's transaction.
   * @param savedViewId - Which view.
   * @param userId - Who is renaming it.
   * @param title - The new name.
   * @param at - When.
   * @returns Whether it was renamed. False means it was not theirs.
   * @throws {Error} If the database refuses.
   */
  async rename(
    tx: Transaction,
    savedViewId: string,
    userId: string,
    title: string,
    at: Date,
  ): Promise<boolean> {
    const { affected } = await tx.update(
      SavedViewRow,
      { savedViewId, userId },
      { title, updatedAt: at },
    );

    return affected === 1;
  }

  /**
   * Forget one.
   *
   * Its shares go with it, by the foreign key: a link to a view that no longer
   * exists resolves to nothing, and keeping the row would keep a record of what
   * somebody used to have saved.
   *
   * @param tx - The caller's transaction.
   * @param savedViewId - Which view.
   * @param userId - Whose it must be.
   * @returns Whether it was removed.
   * @throws {Error} If the database refuses.
   */
  async remove(tx: Transaction, savedViewId: string, userId: string): Promise<boolean> {
    const { affected } = await tx.delete(SavedViewRow, { savedViewId, userId });

    return (affected ?? 0) > 0;
  }

  /**
   * Make a link to a view.
   *
   * @param tx - The caller's transaction.
   * @param savedViewId - Which view. Its ownership is the caller's to check.
   * @param reveals - What the link may disclose.
   * @param at - When.
   * @returns The share, token included. Generated here rather than passed in,
   *   so nothing upstream can weaken it.
   * @throws {Error} If the database refuses.
   */
  async share(
    tx: Transaction,
    savedViewId: string,
    reveals: { title: boolean; owner: boolean },
    at: Date,
  ): Promise<SavedViewShareRow> {
    const row = {
      shareId: randomUUID(),
      token: randomBytes(TOKEN_BYTES).toString("base64url"),
      savedViewId,
      revealsTitle: reveals.title,
      revealsOwner: reveals.owner,
      createdAt: at,
      revokedAt: null,
    };

    await tx.insert(SavedViewShareRow, row);

    return row as SavedViewShareRow;
  }

  /**
   * Read a share by its token, with the view it opens.
   *
   * @param token - The link's secret.
   * @returns The share and its view, or undefined when the token names nothing.
   *   A revoked share still comes back: the caller decides what to say about it,
   *   and "this was withdrawn" is a different answer from "this never existed".
   * @throws {Error} If the database refuses.
   */
  async findShare(
    token: string,
  ): Promise<{ share: SavedViewShareRow; view: SavedViewRow } | undefined> {
    const row = (await this.dataSource
      .getRepository(SavedViewShareRow)
      .createQueryBuilder("share")
      .innerJoinAndMapOne(
        "share.view",
        SavedViewRow,
        "view",
        "view.saved_view_id = share.saved_view_id",
      )
      .where("share.token = :token", { token })
      .getOne()) as (SavedViewShareRow & { view: SavedViewRow }) | null;

    return row === null ? undefined : { share: row, view: row.view };
  }

  /**
   * Every share of a view.
   *
   * @param savedViewId - Which view. Its ownership is the caller's to check.
   * @returns The shares, newest first, revoked ones included.
   * @throws {Error} If the database refuses.
   */
  async listShares(savedViewId: string): Promise<SavedViewShareRow[]> {
    return this.dataSource.getRepository(SavedViewShareRow).find({
      where: { savedViewId },
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Withdraw a link.
   *
   * Marked rather than deleted, so a link somebody still holds can be told it
   * was withdrawn. That is a kinder answer than "no such view", and an honest
   * one — the alternative implies the sender never shared anything.
   *
   * @param tx - The caller's transaction.
   * @param shareId - Which share.
   * @param userId - Who is revoking it, checked against the view's owner.
   * @param at - When.
   * @returns Whether it was withdrawn. False means it was not theirs, or was
   *   already withdrawn.
   * @throws {Error} If the database refuses.
   */
  async revoke(tx: Transaction, shareId: string, userId: string, at: Date): Promise<boolean> {
    const rows: { count: number }[] = await tx.query(
      // Ownership is joined rather than assumed: a share names a view, and only
      // that view's owner may withdraw it.
      `WITH withdrawn AS (
          UPDATE saved_view_shares AS s
             SET revoked_at = $3
            FROM saved_views AS v
           WHERE s.share_id = $1
             AND v.saved_view_id = s.saved_view_id
             AND v.user_id = $2
             AND s.revoked_at IS NULL
       RETURNING 1
       ) SELECT COUNT(*)::int AS count FROM withdrawn`,
      [shareId, userId, at],
    );

    return (rows[0]?.count ?? 0) > 0;
  }
}
