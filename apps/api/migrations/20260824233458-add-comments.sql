-- Conversation about a Moment.
--
-- A Comment is not a Moment (`comments.md:58`): it is mutable conversation
-- rather than a historical record, and when it was written says nothing about
-- when the experience happened.
CREATE TABLE moment_comments (
    comment_id             uuid        PRIMARY KEY,
    moment_id              uuid        NOT NULL,
    author_user_id         uuid        NOT NULL,

    -- The top-level Comment this belongs to, or null when it is one.
    --
    -- What flattens presentation to a single visible level
    -- (`comments.md:161`): replying to a reply joins that reply's thread rather
    -- than nesting deeper, so a discussion cannot become an arbitrarily deep
    -- tree nobody can read on a phone.
    thread_comment_id      uuid,

    -- Which Comment was actually addressed, where that differs from the thread.
    --
    -- The document permits retaining this "where useful", and it is: without it
    -- a reply aimed at one person in a busy thread loses who it was answering.
    in_reply_to_comment_id uuid,

    body                   text        NOT NULL,

    -- Ordering position, and never rewritten. Editing must not move a Comment
    -- through the discussion (`comments.md:271`), so the ordering timestamp is
    -- this one and the edit time is recorded separately.
    created_at             timestamptz NOT NULL DEFAULT now(),

    -- Null until the visible text has changed after publication.
    edited_at              timestamptz,

    -- Soft, so a tombstone can exist where replies still hang from it, and so
    -- moderation retains what `comments.md:296` says it may need.
    deleted_at             timestamptz,

    CONSTRAINT moment_comments_moment_fk
        FOREIGN KEY (moment_id) REFERENCES moments (moment_id) ON DELETE CASCADE,

    CONSTRAINT moment_comments_author_fk
        FOREIGN KEY (author_user_id) REFERENCES users (user_id) ON DELETE RESTRICT,

    CONSTRAINT moment_comments_thread_fk
        FOREIGN KEY (thread_comment_id) REFERENCES moment_comments (comment_id) ON DELETE CASCADE,

    CONSTRAINT moment_comments_in_reply_to_fk
        FOREIGN KEY (in_reply_to_comment_id) REFERENCES moment_comments (comment_id) ON DELETE SET NULL,

    -- Nothing is its own thread or its own reply.
    CONSTRAINT moment_comments_is_not_reflexive CHECK (
        comment_id <> thread_comment_id AND comment_id <> in_reply_to_comment_id
    )
);

-- Top-level Comments on a Moment, oldest first.
--
-- Ascending, unlike every other list in this system. `comments.md:198` explains
-- why: a conversation read newest-first privileges recency over the context
-- that makes later replies comprehensible.
CREATE INDEX moment_comments_top_level_idx
    ON moment_comments (moment_id, created_at ASC, comment_id ASC)
    WHERE thread_comment_id IS NULL;

-- One thread, oldest first.
CREATE INDEX moment_comments_thread_idx
    ON moment_comments (thread_comment_id, created_at ASC, comment_id ASC)
    WHERE thread_comment_id IS NOT NULL;

-- Hiding what somebody wrote from whoever they are blocked apart from.
CREATE INDEX moment_comments_author_idx ON moment_comments (author_user_id);

-- Who a Comment refers to in conversation.
--
-- The resolved relationship, never the typed handle. `comments.md:503` requires
-- a mention to survive its target changing handle, which storing the text could
-- not do.
--
-- A mention is not a tag on the Moment: it says a Comment refers to somebody,
-- never that they were present for the experience (`comments.md:489`).
CREATE TABLE comment_mentions (
    comment_id uuid        NOT NULL,
    user_id    uuid        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (comment_id, user_id),

    CONSTRAINT comment_mentions_comment_fk
        FOREIGN KEY (comment_id) REFERENCES moment_comments (comment_id) ON DELETE CASCADE,

    CONSTRAINT comment_mentions_user_fk
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT
);

CREATE INDEX comment_mentions_user_idx ON comment_mentions (user_id);

-- Reacting to something somebody said.
--
-- Its own table rather than a target shared with `moment_reactions`, which is
-- keyed on a Moment. Two explicit relationships read better than one
-- polymorphic one, and each keeps real foreign keys.
CREATE TABLE comment_reactions (
    comment_id uuid        NOT NULL,
    user_id    uuid        NOT NULL,
    kind       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (comment_id, user_id),

    CONSTRAINT comment_reactions_comment_fk
        FOREIGN KEY (comment_id) REFERENCES moment_comments (comment_id) ON DELETE CASCADE,

    CONSTRAINT comment_reactions_user_fk
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT,

    CONSTRAINT comment_reactions_kind_is_known CHECK (
        kind IN ('loved', 'amused', 'astonished', 'saddened')
    )
);

CREATE INDEX comment_reactions_counting_idx ON comment_reactions (comment_id, kind);
CREATE INDEX comment_reactions_user_idx ON comment_reactions (user_id);

-- Who may join the discussion.
--
-- `anyone` who can see the Moment, `followers` of its author, or nobody.
-- Seeing a Moment does not by itself mean being able to comment on it
-- (`comments.md:417`); this is what separates the two.
--
-- `followers` grants no access: a stranger who could read the Moment still can.
-- It governs participation, which is why it does not contradict the rule that a
-- Follow never bypasses a visibility rule.
ALTER TABLE moments
    ADD COLUMN comment_policy text NOT NULL DEFAULT 'anyone';

ALTER TABLE moments
    ADD CONSTRAINT moments_comment_policy_is_known CHECK (
        comment_policy IN ('anyone', 'followers', 'disabled')
    );
