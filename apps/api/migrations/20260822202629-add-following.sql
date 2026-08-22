-- add-following
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Following: one person choosing to hear about another's history.

-- Whether this account has to approve who follows it.
--
-- One setting with one meaning, deliberately independent of anything else.
-- `social-graph.md` asks for both open and approval-based following "even if
-- the exact account-level privacy model is refined separately", which is
-- permission to add this rather than wait for a privacy model that does not
-- exist. If privacy settings multiply, they should get their own table and this
-- should move with them.
ALTER TABLE user_preferences
    ADD COLUMN requires_follow_approval boolean NOT NULL DEFAULT false;

-- One person following another.
--
-- Directional, and needing no reciprocity: A following B says nothing about
-- whether B follows A (`social-graph.md:36`). This is the relationship between
-- *people*. Following a historical context — an Event, a Location — is a
-- different relationship with different rules, which is why this table is
-- named for what it actually holds.
CREATE TABLE user_follows (
    follower_user_id uuid        NOT NULL,
    followed_user_id uuid        NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (follower_user_id, followed_user_id),

    CONSTRAINT user_follows_follower_fk
        FOREIGN KEY (follower_user_id) REFERENCES users (user_id),

    CONSTRAINT user_follows_followed_fk
        FOREIGN KEY (followed_user_id) REFERENCES users (user_id),

    -- Nobody follows themselves. Their own history is already theirs.
    CONSTRAINT user_follows_is_not_reflexive CHECK (
        follower_user_id <> followed_user_id
    )
);

-- Reading "who follows me" is the direction the primary key cannot serve.
CREATE INDEX user_follows_followed_idx
    ON user_follows (followed_user_id, created_at DESC);

-- Asking to follow somebody whose account requires approval.
--
-- A Follow Request is not a Follow (`social-graph.md:169`). It can be accepted,
-- declined, cancelled, or invalidated by another relationship such as a block.
CREATE TABLE follow_requests (
    request_id        uuid        PRIMARY KEY,
    requester_user_id uuid        NOT NULL,
    requested_user_id uuid        NOT NULL,

    -- `pending`, `accepted`, `declined`, or `cancelled`.
    status            text        NOT NULL DEFAULT 'pending',

    requested_at      timestamptz NOT NULL DEFAULT now(),

    -- Null while pending. When it was accepted, declined, or cancelled.
    resolved_at       timestamptz,

    CONSTRAINT follow_requests_requester_fk
        FOREIGN KEY (requester_user_id) REFERENCES users (user_id),

    CONSTRAINT follow_requests_requested_fk
        FOREIGN KEY (requested_user_id) REFERENCES users (user_id),

    CONSTRAINT follow_requests_is_not_reflexive CHECK (
        requester_user_id <> requested_user_id
    ),

    CONSTRAINT follow_requests_status_is_known CHECK (
        status IN ('pending', 'accepted', 'declined', 'cancelled')
    ),

    -- A pending request has not been resolved; a resolved one has.
    CONSTRAINT follow_requests_resolution_matches_status CHECK (
        (status = 'pending' AND resolved_at IS NULL)
        OR (status <> 'pending' AND resolved_at IS NOT NULL)
    )
);

-- One open request at a time between two people, and no more.
--
-- Partial, so resolved requests accumulate rather than being overwritten. That
-- is deliberate: `social-graph.md:184` requires that repeated requests not
-- become a harassment mechanism, and says the cooldown policy is for later
-- product design but "the social model must support it". Keeping every request
-- is what makes a cooldown implementable later without one being invented now.
CREATE UNIQUE INDEX follow_requests_pending_idx
    ON follow_requests (requester_user_id, requested_user_id)
    WHERE status = 'pending';

-- Reading "who is waiting on me", which is the only list this table serves.
CREATE INDEX follow_requests_requested_idx
    ON follow_requests (requested_user_id, requested_at DESC)
    WHERE status = 'pending';
