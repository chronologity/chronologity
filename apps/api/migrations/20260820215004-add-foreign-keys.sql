-- add-foreign-keys
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- The schema has had no foreign keys. That was a consequence of event sourcing:
-- referential integrity was the aggregate's job, and these tables were treated
-- as projections rather than as the record. ADR-092 made PostgreSQL the sole
-- authority, which makes the database the right place for those relationships.
--
-- Every constraint here is ON DELETE RESTRICT, with one exception noted below.
-- That is deliberate and follows from the product model rather than from
-- caution: `docs/product/users.md:299` states that account deletion is not
-- equivalent to `DELETE FROM users`, lists eleven categories of data a User may
-- relate to, and requires the fate of each to be decided deliberately. CASCADE
-- would decide all of them silently, by a schema default nobody revisits — and
-- would leave the media bytes in object storage that no foreign key reaches.
--
-- RESTRICT blocks nothing that exists today, because nothing deletes a User.
-- What it does is force the deletion service, when it arrives, to be written
-- against constraints that ask the question rather than answer it.

-- ─────────────────────────────────────────────────────────────
-- Orphans
--
-- Rows referencing a parent that does not exist. Unusable by definition:
-- nothing can resolve them, and no query that joins to the parent returns
-- them. They are development debris, plus rows written before `identities`
-- existed at all — that table arrived only with the architecture migration.
--
-- Deleted here rather than left, because the constraints below cannot be
-- created while they exist and this migration must apply to a database that
-- has been developed against. There is no production data.
--
-- Order matters. Removing users orphaned from identities creates further
-- orphans in everything a User owns, so identities are settled first.
-- ─────────────────────────────────────────────────────────────

DELETE FROM identity_emails e
 WHERE NOT EXISTS (SELECT 1 FROM identities i WHERE i.identity_id = e.identity_id);

DELETE FROM identity_passwords p
 WHERE NOT EXISTS (SELECT 1 FROM identities i WHERE i.identity_id = p.identity_id);

DELETE FROM sessions s
 WHERE NOT EXISTS (SELECT 1 FROM identities i WHERE i.identity_id = s.identity_id);

DELETE FROM users u
 WHERE NOT EXISTS (SELECT 1 FROM identities i WHERE i.identity_id = u.identity_id);

-- Now the User-owned tables, including anything orphaned by the delete above.

DELETE FROM user_handles h
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = h.user_id);

DELETE FROM user_preferences p
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = p.user_id);

DELETE FROM user_restricted_data r
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = r.user_id);

DELETE FROM authorization_user_roles a
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = a.user_id);

DELETE FROM uploads x
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = x.owner_user_id);

DELETE FROM locations l
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = l.recorded_by_user_id);

-- Not deleted: a role granted by an account that no longer exists is still a
-- role that was granted. The attribution goes; the grant stays. That is the
-- same thing the SET NULL constraint below does from here on.
UPDATE authorization_user_roles a
   SET assigned_by = NULL
 WHERE a.assigned_by IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = a.assigned_by);

-- ─────────────────────────────────────────────────────────────
-- Index
--
-- PostgreSQL does not index a referencing column automatically, and a parent
-- delete has to check every child. Every other referencing column here already
-- leads a btree index; this one's only index is partial —
-- `UNIQUE (user_id) WHERE released_at IS NULL` — so released handles, which are
-- exactly the rows that accumulate, are not covered by it.
-- ─────────────────────────────────────────────────────────────

CREATE INDEX user_handles_user_idx ON user_handles (user_id);

-- ─────────────────────────────────────────────────────────────
-- Identity relationships
-- ─────────────────────────────────────────────────────────────

ALTER TABLE identity_emails
    ADD CONSTRAINT identity_emails_identity_fk
    FOREIGN KEY (identity_id) REFERENCES identities (identity_id) ON DELETE RESTRICT;

ALTER TABLE identity_passwords
    ADD CONSTRAINT identity_passwords_identity_fk
    FOREIGN KEY (identity_id) REFERENCES identities (identity_id) ON DELETE RESTRICT;

ALTER TABLE sessions
    ADD CONSTRAINT sessions_identity_fk
    FOREIGN KEY (identity_id) REFERENCES identities (identity_id) ON DELETE RESTRICT;

ALTER TABLE users
    ADD CONSTRAINT users_identity_fk
    FOREIGN KEY (identity_id) REFERENCES identities (identity_id) ON DELETE RESTRICT;

-- ─────────────────────────────────────────────────────────────
-- User relationships
-- ─────────────────────────────────────────────────────────────

-- A released handle stays in cooldown after its holder is gone, which is why
-- this restricts rather than cascades: releasing the handle is part of deleting
-- an account, not a side effect of it. Handing a recognisable handle straight to
-- somebody else is what `identity.md:113` warns about.
ALTER TABLE user_handles
    ADD CONSTRAINT user_handles_user_fk
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT;

ALTER TABLE user_preferences
    ADD CONSTRAINT user_preferences_user_fk
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT;

-- Restricted personal data lives in its own table so that it can be erased by a
-- targeted delete. That erasure is a deliberate operation, not something a
-- cascade performs on the way past.
ALTER TABLE user_restricted_data
    ADD CONSTRAINT user_restricted_data_user_fk
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT;

ALTER TABLE authorization_user_roles
    ADD CONSTRAINT authorization_user_roles_user_fk
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT;

-- The exception. Already nullable, because a role granted from the command line
-- has no acting User. A role change should survive the departure of whoever made
-- it; what it loses is the attribution, not the fact.
ALTER TABLE authorization_user_roles
    ADD CONSTRAINT authorization_user_roles_assigned_by_fk
    FOREIGN KEY (assigned_by) REFERENCES users (user_id) ON DELETE SET NULL;

-- Deleting the row would not delete the bytes. Object storage is beyond the
-- reach of any constraint here, so removing an upload has to be an operation
-- that knows about both.
ALTER TABLE uploads
    ADD CONSTRAINT uploads_owner_fk
    FOREIGN KEY (owner_user_id) REFERENCES users (user_id) ON DELETE RESTRICT;

-- A Location is shared: two people choosing the same search result reach one
-- place, and a Moment of theirs may depend on it. Deleting whoever recorded it
-- must not take the place with them (`users.md:326`), so this restricts until
-- the deletion service decides what happens to the provenance.
ALTER TABLE locations
    ADD CONSTRAINT locations_recorded_by_fk
    FOREIGN KEY (recorded_by_user_id) REFERENCES users (user_id) ON DELETE RESTRICT;

-- ─────────────────────────────────────────────────────────────
-- Deliberately without foreign keys
--
-- `auth_audit_events` and `authorization_audit_events` reference identities,
-- sessions, and users, and get no constraint. A foreign key would force a
-- choice between destroying evidence on deletion and preventing deletion
-- entirely, and neither is acceptable: audit rows are evidence, retained on
-- their own basis and their own schedule, and they are meant to outlive what
-- they describe. Retention for audit reasons does not imply visibility.
--
-- `outbox_messages.aggregate_id` is polymorphic — an upload, a User, or
-- whatever the publishing service names — so it cannot reference one table.
--
-- `projection_processed_events.event_id` identifies a message, not a row.
--
-- `magic_link_tokens.email` is issued for addresses that have no Identity on
-- purpose: redeeming a sign-in link is what creates the account.
-- ─────────────────────────────────────────────────────────────
