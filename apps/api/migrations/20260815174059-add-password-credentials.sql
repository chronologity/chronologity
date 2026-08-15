-- add-password-credentials
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Password credentials for Identities that have one.

-- One row per Identity that has set a password.
--
-- Absence is a valid state: magic link remains a first-class way to sign in,
-- so an Identity may never have a password at all.
--
-- The hash lives here rather than in event history because history is
-- permanent. A hash written into an immutable stream could never be rotated
-- away, and would stay offline-attackable for as long as the stream exists.
CREATE TABLE identity_passwords (
    identity_id  uuid        PRIMARY KEY,
    -- PHC string: carries its own algorithm and cost parameters, which is what
    -- lets cost be raised without invalidating anyone.
    password_hash text       NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
