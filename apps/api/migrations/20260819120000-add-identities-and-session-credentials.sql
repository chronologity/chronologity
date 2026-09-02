-- add-identities-and-session-credentials
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- PostgreSQL becomes the authority for authentication (ADR-092, ADR-094). Two
-- things previously existed only as replayed history and now need rows.

-- Identities.
--
-- `identity_emails.identity_id` and `users.identity_id` have always pointed at
-- an entity with no row anywhere: an Identity existed as a stream and nothing
-- else. This is that row. It holds no credential and no address — both are
-- claims about an Identity rather than part of one, and both must be removable
-- without erasing the fact that the account existed.
CREATE TABLE identities (
    identity_id uuid        PRIMARY KEY,
    created_at  timestamptz NOT NULL
);

-- The credential a Session rotates, and how many times it has rotated.
--
-- `sessions` is now the authority for whether a Session may authenticate a
-- request, replacing the aggregate that decided it before (ADR-094). That is a
-- strict improvement rather than a relaxation: revocation is written
-- synchronously in the request that causes it, so reading the row is fresher
-- than replaying a stream, and it takes the event store off the hot path of
-- every authenticated request.
--
-- The hash is nullable only because Sessions created before this migration
-- have none to record. A null never equals a presented hash, so those Sessions
-- simply cannot be refreshed — which is the correct outcome, not a gap.
ALTER TABLE sessions
    ADD COLUMN refresh_token_hash  text,
    ADD COLUMN refresh_generation  integer NOT NULL DEFAULT 0;

COMMENT ON TABLE sessions IS
    'Authoritative Session state. Decides whether a Session may authenticate a request.';
