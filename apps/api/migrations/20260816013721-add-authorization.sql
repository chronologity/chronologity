-- add-authorization
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Platform roles: what a User may do, as distinct from who they are.

-- Elevated role assignments.
--
-- Only elevated roles are stored. Every User has the baseline `user`
-- capabilities by virtue of being a User, so a row saying so would add nothing
-- while making a missing row indistinguishable from a corrupted one, and would
-- couple account creation to authorization.
--
-- Read on every privileged request rather than cached in a token: a token
-- claim is a cache of authorization state, not the source of truth, and the
-- simplest way to honour that is not to cache it. Removing someone's role
-- stops their next request, not their next token refresh.
CREATE TABLE authorization_user_roles (
    user_id     uuid        NOT NULL,
    role        text        NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    -- Who granted it. Null for a grant made through the CLI, where authority
    -- came from infrastructure access rather than from an acting User.
    assigned_by uuid,
    PRIMARY KEY (user_id, role)
);

-- Privileged actions are audited (`authorization.md:567-571`).
--
-- A separate table from `auth_audit_events` rather than a widened one. That
-- table is keyed on identity and session and answers "who signed in, from
-- where, and was it refused"; a role change is one User acting on another, and
-- an actor/subject pair does not fit a schema built for the other question.
CREATE TABLE authorization_audit_events (
    id              uuid        PRIMARY KEY,
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    event_type      text        NOT NULL,
    -- Null when the actor is the CLI. The reason column records why.
    actor_user_id   uuid,
    subject_user_id uuid        NOT NULL,
    role            text        NOT NULL,
    outcome         text        NOT NULL,
    reason          text,
    trace_id        text,
    context         jsonb
);

-- Answering "what was done to this account, and by whom" is the question an
-- audit trail exists for.
CREATE INDEX authorization_audit_subject_idx
    ON authorization_audit_events (subject_user_id, occurred_at DESC);

CREATE INDEX authorization_audit_actor_idx
    ON authorization_audit_events (actor_user_id, occurred_at DESC)
    WHERE actor_user_id IS NOT NULL;
