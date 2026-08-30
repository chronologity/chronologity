-- Keeping a perspective on history, and coming back to it.
--
-- A Saved View stores a **View Specification** — the product-level object the
-- derivation engine already takes — and never a list of Moments. That is the
-- whole point: what is kept is what somebody was looking at, so reopening it
-- next year derives current history rather than replaying an old answer.
--
-- Consequently a Saved View grants nothing. It is a request somebody wrote
-- down, authorised afresh every time it is opened, and a Moment that was public
-- when it was saved shows nothing when it is private now.
CREATE TABLE saved_views (
    saved_view_id uuid        PRIMARY KEY,
    user_id       uuid        NOT NULL,

    -- What they called it. Their words about their own history, which is why
    -- sharing does not reveal it unless the sender says so.
    title         text        NOT NULL,

    -- The specification, as JSON. Stored rather than decomposed into columns
    -- because it is a versioned product object whose shape is allowed to
    -- change: `saved-views.md` asks that older ones be *migrated* on read, and
    -- a column per field would make every addition a migration of this table
    -- instead.
    --
    -- Deliberately not queried by its contents. Nothing here filters or sorts
    -- on what is inside the specification, so it needs no index of its own.
    specification jsonb       NOT NULL,

    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT saved_views_title_is_not_empty CHECK (length(btrim(title)) > 0),

    -- Cascading, unlike most references to a person here. A Saved View is not a
    -- record about the world that outlives its owner: it is a note they wrote
    -- to themselves, and the account sweep names it too.
    CONSTRAINT saved_views_user_fk
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- Somebody's own list, newest first. The identifier breaks ties because the
-- cursor is a `(timestamp, id)` tuple, as everywhere.
CREATE INDEX saved_views_user_idx
    ON saved_views (user_id, created_at DESC, saved_view_id DESC);

-- A link that opens somebody else's view.
--
-- The share carries what it may disclose rather than the view deciding, because
-- one view may be shared twice on different terms: a title that is fine for a
-- sibling is not necessarily fine for a colleague.
--
-- What it never carries is access. `saved-views.md:340` is unambiguous — sharing
-- must never confer sight of a Moment the recipient could not otherwise view —
-- so opening one derives for whoever opened it, and two people following one
-- link see different history.
CREATE TABLE saved_view_shares (
    share_id      uuid        PRIMARY KEY,

    -- The capability. Long and random: it is the only thing standing between a
    -- forwarded link and the view, so it is not a guessable identifier.
    token         text        NOT NULL,

    saved_view_id uuid        NOT NULL,

    -- Whether the recipient is told what it is called, and who saved it. Both
    -- default to false: revealing is an act, not a consequence of sharing.
    reveals_title boolean     NOT NULL DEFAULT false,
    reveals_owner boolean     NOT NULL DEFAULT false,

    created_at    timestamptz NOT NULL DEFAULT now(),
    -- When the sender withdrew it. Kept rather than deleted so that a link
    -- somebody still holds can be told it was revoked rather than that it never
    -- existed — the two are different, and only one is honest.
    revoked_at    timestamptz,

    CONSTRAINT saved_view_shares_token_is_unique UNIQUE (token),

    -- With the view. A share of something that no longer exists is a link that
    -- resolves to nothing, and keeping it would be keeping a record of what
    -- somebody used to have saved.
    CONSTRAINT saved_view_shares_view_fk
        FOREIGN KEY (saved_view_id) REFERENCES saved_views (saved_view_id) ON DELETE CASCADE
);

CREATE INDEX saved_view_shares_view_idx
    ON saved_view_shares (saved_view_id, created_at DESC);
