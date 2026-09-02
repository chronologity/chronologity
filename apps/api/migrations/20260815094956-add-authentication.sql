-- add-authentication
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Authentication state that must not live in immutable event history.
-- Magic-link tokens are operational secrets, and session read state is derived.

-- Single-use magic-link tokens.
--
-- The token itself is never stored: only its SHA-256 hash, so a database leak
-- does not hand over working login links. Rows are consumed atomically and
-- retained briefly after use, because "this link was already used" is a more
-- useful answer than "this link does not exist" when investigating abuse.
CREATE TABLE magic_link_tokens (
    token_hash    text        PRIMARY KEY,
    email         text        NOT NULL,
    purpose       text        NOT NULL,
    expires_at    timestamptz NOT NULL,
    consumed_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX magic_link_tokens_expires_at_idx ON magic_link_tokens (expires_at);

-- Verified authentication emails.
--
-- The only place an address resolves to an Identity. Normalised form is unique:
-- two Identities cannot claim the same login address.
CREATE TABLE identity_emails (
    normalized_email text        PRIMARY KEY,
    email            text        NOT NULL,
    identity_id      uuid        NOT NULL,
    verified_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX identity_emails_identity_id_idx ON identity_emails (identity_id);

-- Session read model.
--
-- Derived from Session history and used for the user-facing active-session
-- list. It is deliberately NOT the authority for whether a session is valid:
-- that is decided from the Session aggregate, so a lagging projection can
-- never leave a revoked session working.
CREATE TABLE sessions (
    session_id        uuid        PRIMARY KEY,
    identity_id       uuid        NOT NULL,
    created_at        timestamptz NOT NULL,
    expires_at        timestamptz NOT NULL,
    last_refreshed_at timestamptz,
    revoked_at        timestamptz,
    revocation_reason text,
    client_kind       text
);

CREATE INDEX sessions_identity_id_idx ON sessions (identity_id, created_at DESC);

-- Security audit records, kept separate from ordinary logs (ADR-047).
--
-- Never contains a credential: only identifiers, outcomes, and reasons.
CREATE TABLE auth_audit_events (
    id           uuid        PRIMARY KEY,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    event_type   text        NOT NULL,
    identity_id  uuid,
    session_id   uuid,
    outcome      text        NOT NULL,
    reason       text,
    trace_id     text,
    context      jsonb
);

CREATE INDEX auth_audit_events_identity_idx ON auth_audit_events (identity_id, occurred_at DESC);
CREATE INDEX auth_audit_events_occurred_at_idx ON auth_audit_events (occurred_at DESC);
