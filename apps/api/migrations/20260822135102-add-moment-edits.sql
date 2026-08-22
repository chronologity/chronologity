-- add-moment-edits
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- What was changed about a Moment, and what it was before.

-- A change somebody made to a Moment.
--
-- `moments.md:534` asks that corrections be represented explicitly. Editing is
-- permitted — the same section is clear that historical integrity does not mean
-- "absolute technical immutability" — but a Moment that quietly moved through
-- history, or quietly lost a photograph, would leave nothing to trust.
--
-- Every edit is recorded, not only the ones that move a Moment in time. Which
-- kinds matter is a product question nobody has answered, and keeping all of
-- them means the answer can be given later from real records rather than
-- guessed at now.
CREATE TABLE moment_edits (
    edit_id           uuid        PRIMARY KEY,
    moment_id         uuid        NOT NULL,

    -- Who made the change. Only a Moment's author can today, so this always
    -- equals the Moment's author — recorded anyway, because "who changed this"
    -- stops being obvious the moment anybody else can.
    edited_by_user_id uuid        NOT NULL,

    -- What kind of change it was.
    --
    -- The kind is recorded rather than inferred from what changed, because the
    -- product distinguishes them: `moments.md:443` calls moving a Moment in
    -- time "a historical correction rather than an ordinary cosmetic edit",
    -- while a caption is enrichment. A reader should not have to reconstruct
    -- which one happened.
    kind              text        NOT NULL,

    -- What the changed thing was before, shaped to the kind.
    --
    -- `jsonb` because the shapes genuinely differ — an occurrence has three
    -- parts and a removal has one identifier — and the alternative is a table
    -- of mostly-null columns. Both audit tables already carry a `context
    -- jsonb`, so this is the existing convention rather than a new one.
    previous          jsonb       NOT NULL,

    edited_at         timestamptz NOT NULL DEFAULT now(),

    -- Unlike `auth_audit_events` and `authorization_audit_events`, this table
    -- has a foreign key and it cascades.
    --
    -- Those two deliberately have none, so that security evidence outlives what
    -- it describes (ADR-097). This is different in kind: a Moment's edit
    -- history is the author's own content, not evidence held against them. When
    -- erasure eventually removes a Moment it must take this with it, or the
    -- record of what somebody wrote would outlive their right to remove it.
    CONSTRAINT moment_edits_moment_fk
        FOREIGN KEY (moment_id) REFERENCES moments (moment_id)
        ON DELETE CASCADE,

    CONSTRAINT moment_edits_author_fk
        FOREIGN KEY (edited_by_user_id) REFERENCES users (user_id),

    CONSTRAINT moment_edits_kind_is_known CHECK (
        kind IN (
            'caption_changed',
            'occurrence_corrected',
            'media_added',
            'media_removed',
            'media_reordered',
            'deleted'
        )
    )
);

-- The order a Moment's history is read in, when anything eventually reads it.
CREATE INDEX moment_edits_moment_idx
    ON moment_edits (moment_id, edited_at DESC);
