import {
  viewSpecificationSchema,
  type CreateSavedViewRequest,
  type CreateShareRequest,
  type SavedView,
  type SavedViewList,
  type SavedViewShare,
  type SavedViewShareList,
  type SharedView,
  type ViewSpecification,
} from "@chronologity/contracts";
import type { DataSource } from "typeorm";
import { NotFoundError } from "../../lib/errors/not-found-error.js";
import { ValidationError } from "../../lib/errors/validation-error.js";
import { withTransaction } from "../../lib/database/transaction.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination/cursor.js";
import type { UserRepository } from "../users/user.repository.js";
import { presentAwareness, type StoredAwareness } from "./saved-view-awareness.js";
import type { SavedViewRow } from "./saved-view.model.js";
import type { SavedViewRepository } from "./saved-view.repository.js";

/**
 * Keeping a perspective on history, and coming back to it.
 *
 * What is stored is a View Specification — the object the derivation engine
 * already takes — so reopening derives current history rather than replaying an
 * old answer. That is what makes a saved view mean the same thing next year
 * while showing more of it.
 *
 * **A Saved View grants nothing.** Everything here hands a specification to the
 * engine along with *whoever is asking*, never whoever saved it, so a Moment
 * that was public when it was kept shows nothing when it is private now.
 */
export class SavedViewService {
  /**
   * Build the service.
   *
   * @param dataSource - For transactions.
   * @param savedViews - Where views and their shares live.
   * @param users - Read to name an owner, when a share reveals one.
   * @param clock - Injected so a test can pin when something was saved.
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly savedViews: SavedViewRepository,
    private readonly users: UserRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Keep the view somebody is looking at.
   *
   * @param userId - Whose it is.
   * @param request - The title and the specification.
   * @returns The view as kept.
   * @throws {Error} If the database refuses.
   */
  async save(userId: string, request: CreateSavedViewRequest): Promise<SavedView> {
    const at = this.clock();
    const savedViewId = await withTransaction(this.dataSource, (tx) =>
      this.savedViews.save(tx, userId, request.title, request.view, at),
    );

    return {
      savedViewId,
      title: request.title,
      view: request.view,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      available: true,
      followed: false,
    };
  }

  /**
   * Record that somebody looked at their own view.
   *
   * An act rather than a consequence of reading. A client listing views has not
   * looked at any of them, and clearing a badge because a list was prefetched
   * would lose somebody the only signal they had.
   *
   * @param savedViewId - Which view.
   * @param userId - Whose it must be.
   * @returns Nothing.
   * @throws {NotFoundError} If there is no such view of theirs.
   */
  async visit(savedViewId: string, userId: string): Promise<void> {
    const visited = await withTransaction(this.dataSource, (tx) =>
      this.savedViews.visit(tx, savedViewId, userId, this.clock()),
    );

    if (!visited) {
      throw new NotFoundError("No such saved view");
    }
  }

  /**
   * Somebody's saved views.
   *
   * @param userId - Whose.
   * @param request - How many, and where to resume.
   * @returns The page.
   * @throws {ValidationError} If the cursor is not one this system issued.
   */
  async list(
    userId: string,
    request: { limit: number; cursor?: string | undefined },
  ): Promise<SavedViewList> {
    const after = request.cursor === undefined ? undefined : decodeCursor(request.cursor);
    const rows = await this.savedViews.list(userId, request.limit + 1, after);
    const page = rows.slice(0, request.limit);
    const last = page[page.length - 1];
    const awareness = await this.savedViews.awarenessFor(page.map((row) => row.savedViewId));
    const now = this.clock();

    return {
      items: page.map((row) => present(row, awareness.get(row.savedViewId), now)),
      nextCursor:
        rows.length > request.limit && last !== undefined
          ? encodeCursor(last.createdAt, last.savedViewId)
          : undefined,
    };
  }

  /**
   * Read one of somebody's own views.
   *
   * @param savedViewId - Which view.
   * @param userId - Who is asking.
   * @returns It.
   * @throws {NotFoundError} If there is no such view of theirs. Somebody else's
   *   reads as absent rather than forbidden, so identifiers cannot be probed.
   */
  async get(savedViewId: string, userId: string): Promise<SavedView> {
    const row = await this.require(savedViewId, userId);
    const awareness = await this.savedViews.awarenessFor([savedViewId]);

    return present(row, awareness.get(savedViewId), this.clock());
  }

  /**
   * Start or stop hearing about a view.
   *
   * @param savedViewId - Which view.
   * @param userId - Whose it must be.
   * @param followed - Whether to hear about it.
   * @returns Nothing.
   * @throws {NotFoundError} If there is no such view of theirs.
   */
  async follow(savedViewId: string, userId: string, followed: boolean): Promise<void> {
    const changed = await withTransaction(this.dataSource, (tx) =>
      this.savedViews.follow(tx, savedViewId, userId, followed),
    );

    if (!changed) {
      throw new NotFoundError("No such saved view");
    }
  }

  /**
   * Rename one.
   *
   * @param savedViewId - Which view.
   * @param userId - Who is renaming it.
   * @param title - The new name.
   * @returns The view as it now stands.
   * @throws {NotFoundError} If there is no such view of theirs.
   */
  async rename(savedViewId: string, userId: string, title: string): Promise<SavedView> {
    const at = this.clock();
    const renamed = await withTransaction(this.dataSource, (tx) =>
      this.savedViews.rename(tx, savedViewId, userId, title, at),
    );

    if (!renamed) {
      throw new NotFoundError("No such saved view");
    }

    return present({ ...(await this.require(savedViewId, userId)), title, updatedAt: at });
  }

  /**
   * Forget one.
   *
   * @param savedViewId - Which view.
   * @param userId - Whose it must be.
   * @returns Nothing.
   * @throws {NotFoundError} If there is no such view of theirs.
   */
  async remove(savedViewId: string, userId: string): Promise<void> {
    const removed = await withTransaction(this.dataSource, (tx) =>
      this.savedViews.remove(tx, savedViewId, userId),
    );

    if (!removed) {
      throw new NotFoundError("No such saved view");
    }
  }

  /**
   * Make a link to a view.
   *
   * @param savedViewId - Which view.
   * @param userId - Whose it must be.
   * @param request - What the link may disclose. Both default to nothing.
   * @returns The share, its token included — shown so the sender can copy it.
   * @throws {NotFoundError} If there is no such view of theirs.
   */
  async share(
    savedViewId: string,
    userId: string,
    request: CreateShareRequest,
  ): Promise<SavedViewShare> {
    await this.require(savedViewId, userId);

    const at = this.clock();
    const share = await withTransaction(this.dataSource, (tx) =>
      this.savedViews.share(
        tx,
        savedViewId,
        { title: request.revealsTitle, owner: request.revealsOwner },
        at,
      ),
    );

    return {
      shareId: share.shareId,
      token: share.token,
      revealsTitle: share.revealsTitle,
      revealsOwner: share.revealsOwner,
      createdAt: at.toISOString(),
    };
  }

  /**
   * Every link somebody has made to a view.
   *
   * @param savedViewId - Which view.
   * @param userId - Whose it must be.
   * @returns The shares, revoked ones included, so somebody can see what they
   *   have given out and what they have taken back.
   * @throws {NotFoundError} If there is no such view of theirs.
   */
  async shares(savedViewId: string, userId: string): Promise<SavedViewShareList> {
    await this.require(savedViewId, userId);

    return {
      items: (await this.savedViews.listShares(savedViewId)).map((share) => ({
        shareId: share.shareId,
        token: share.token,
        revealsTitle: share.revealsTitle,
        revealsOwner: share.revealsOwner,
        createdAt: share.createdAt.toISOString(),
        ...(share.revokedAt === null ? {} : { revokedAt: share.revokedAt.toISOString() }),
      })),
    };
  }

  /**
   * Withdraw a link.
   *
   * @param shareId - Which share.
   * @param userId - Who is withdrawing it.
   * @returns Nothing.
   * @throws {NotFoundError} If it is not theirs, or was already withdrawn.
   */
  async revoke(shareId: string, userId: string): Promise<void> {
    const revoked = await withTransaction(this.dataSource, (tx) =>
      this.savedViews.revoke(tx, shareId, userId, this.clock()),
    );

    if (!revoked) {
      throw new NotFoundError("No such share");
    }
  }

  /**
   * Open a link somebody sent.
   *
   * Returns the specification and whatever the sender chose to disclose — never
   * any history. The reader's own client then derives it through the Timeline,
   * for the reader, which is what keeps `saved-views.md:340` true: sharing must
   * never confer sight of a Moment the recipient could not otherwise view.
   *
   * Two people following one link therefore see different Moments, and neither
   * learns what the other saw.
   *
   * @param token - The link's secret.
   * @returns The view, with a title and an owner only if the sender said so.
   * @throws {NotFoundError} If the token names nothing, or names something
   *   withdrawn. The two answer alike: a withdrawn link should not confirm that
   *   it once worked to somebody who merely guessed at it.
   */
  async open(token: string): Promise<SharedView> {
    const found = await this.savedViews.findShare(token);

    if (found === undefined || found.share.revokedAt !== null) {
      throw new NotFoundError("No such shared view");
    }

    const owner = found.share.revealsOwner
      ? await this.users.findPublic(found.view.userId)
      : undefined;

    return {
      view: specificationOf(found.view),
      ...(found.share.revealsTitle ? { title: found.view.title } : {}),
      ...(owner === undefined ? {} : { owner }),
    };
  }

  /**
   * Read one of somebody's own views, or refuse.
   *
   * @param savedViewId - Which view.
   * @param userId - Who is asking.
   * @returns The row.
   * @throws {NotFoundError} If there is no such view of theirs.
   */
  private async require(savedViewId: string, userId: string): Promise<SavedViewRow> {
    const row = await this.savedViews.find(savedViewId, userId);

    if (row === undefined) {
      throw new NotFoundError("No such saved view");
    }

    return row;
  }
}

/**
 * Read a stored specification back.
 *
 * Validated rather than trusted, because it was written by an older version of
 * this system than the one reading it — possibly much older. `saved-views.md`
 * asks that such a view be *migrated* rather than refused, so a specification
 * that no longer parses is a bug to notice rather than a view to discard, and
 * the version it carries is what a migration would key on.
 *
 * @param row - The stored view.
 * @returns Its specification.
 * @throws {ValidationError} If it cannot be read at all. Deliberately loud:
 *   silently substituting a default would open a view onto history nobody
 *   asked to see.
 */
function specificationOf(row: SavedViewRow): ViewSpecification {
  const parsed = viewSpecificationSchema.safeParse(row.specification);

  if (!parsed.success) {
    throw new ValidationError("That saved view can no longer be read", {
      field: "specification",
    });
  }

  return parsed.data;
}

/**
 * A stored view as the contract presents it.
 *
 * @param row - The stored view.
 * @param awareness - What was last counted for it, when anything was.
 * @param now - What counts as now, for deciding whether that count is too old.
 * @returns The contract shape.
 */
function present(row: SavedViewRow, awareness?: StoredAwareness, now?: Date): SavedView {
  const view = specificationOf(row);
  const newMoments = presentAwareness(awareness, view, row.lastVisitedAt ?? null, now);

  return {
    savedViewId: row.savedViewId,
    title: row.title,
    view,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    followed: row.followed,
    ...(row.lastVisitedAt === null || row.lastVisitedAt === undefined
      ? {}
      : { lastVisitedAt: row.lastVisitedAt.toISOString() }),
    ...(newMoments === undefined ? {} : { newMoments }),
    // Whether the context still resolves is a question for whoever opens it:
    // answering it here would mean a query per view on every list, which is
    // exactly the cost the measurement ruled out.
    available: true,
  };
}
