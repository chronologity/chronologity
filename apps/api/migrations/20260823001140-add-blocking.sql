-- add-blocking
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Blocking: refusing a relationship rather than merely declining one.

-- One person blocking another.
--
-- Its own table rather than a flag on `user_follows`, which `social-graph.md`
-- requires explicitly: "Blocking should be designed as an explicit relationship
-- state, not as a specialized Follow flag." A block outlives the follow it
-- severs, and exists whether or not one was ever there.
--
-- Directional as an action, and its consequences reach both ways: when A blocks
-- B, neither may follow the other and any request between them is settled.
CREATE TABLE user_blocks (
    blocker_user_id uuid        NOT NULL,
    blocked_user_id uuid        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (blocker_user_id, blocked_user_id),

    CONSTRAINT user_blocks_blocker_fk
        FOREIGN KEY (blocker_user_id) REFERENCES users (user_id),

    CONSTRAINT user_blocks_blocked_fk
        FOREIGN KEY (blocked_user_id) REFERENCES users (user_id),

    CONSTRAINT user_blocks_is_not_reflexive CHECK (
        blocker_user_id <> blocked_user_id
    )
);

-- Reading somebody's own list, newest first, with the identifier settling ties
-- so a page boundary cannot skip or repeat a row.
CREATE INDEX user_blocks_blocker_idx
    ON user_blocks (blocker_user_id, created_at DESC, blocked_user_id DESC);

-- The direction every follow is checked against: has this person been blocked
-- by the one they are trying to reach. Read on the path of every follow, which
-- is why it is an index rather than a scan.
CREATE INDEX user_blocks_blocked_idx
    ON user_blocks (blocked_user_id);
