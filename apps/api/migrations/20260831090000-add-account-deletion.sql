-- Deleting an account.
--
-- Deactivating one hides it and can be undone. Nothing deleted one, and the
-- schema has been waiting for this: thirteen foreign keys into `users` are
-- `ON DELETE RESTRICT` precisely so that whoever built deletion would have to
-- answer what happens to each rather than inherit an answer from a default.
--
-- The answer taken is that the row is tombstoned rather than removed. Everything
-- about the person is erased and everything they authored is erased, but an
-- anonymous row survives — because two of the references into `users` are shared
-- reference data that other people's Moments point at, and both columns are
-- NOT NULL. Removing the row would mean either loosening shared attribution or
-- destroying Locations and Events somebody else's history depends on.
-- `architecture/privacy.md:1105` contemplates exactly this: a tombstone and a
-- hard delete are both required, in different places.

-- A fourth account state.
--
-- Distinct from `deactivated`, which is reversible and is what somebody who
-- wants to step away should use. This one is not: by the time it is set, the
-- addresses and the password are already gone.
ALTER TABLE users
    DROP CONSTRAINT users_status_check;

ALTER TABLE users
    ADD CONSTRAINT users_status_check
        CHECK (status IN ('active', 'deactivated', 'suspended', 'deleted'));

-- The erasure ledger learns a second subject.
--
-- 5R-1 deliberately admitted only `moment`, so that a worker could not accept
-- work it had no code to do. The worker now has that code.
ALTER TABLE erasure_requests
    DROP CONSTRAINT erasure_requests_subject_type_check;

ALTER TABLE erasure_requests
    ADD CONSTRAINT erasure_requests_subject_type_check
        CHECK (subject_type IN ('moment', 'account'));

-- Reports about other people outlive the account that filed them.
--
-- These cascaded, which meant deleting an account destroyed the reports it had
-- filed — evidence about somebody else's conduct, held by somebody who was
-- never party to the deletion. It also meant a reported person could erase the
-- complaints against them by leaving.
--
-- `product/privacy.md:618` names retaining narrowly required safety records as
-- a deletion concept in its own right, distinct from removing content from
-- ordinary access. This is that narrow case: the report survives and the
-- reporter does not.
--
-- Appeals and decisions about the account's *own* content are not touched here.
-- Those concern the departed account rather than anybody else, and erasure
-- removes them.
ALTER TABLE moderation_reports
    ALTER COLUMN reporter_user_id DROP NOT NULL;

ALTER TABLE moderation_reports
    DROP CONSTRAINT moderation_reports_reporter_fk;

ALTER TABLE moderation_reports
    ADD CONSTRAINT moderation_reports_reporter_fk
        FOREIGN KEY (reporter_user_id) REFERENCES users (user_id) ON DELETE SET NULL;

ALTER TABLE accuracy_reports
    ALTER COLUMN reporter_user_id DROP NOT NULL;

ALTER TABLE accuracy_reports
    DROP CONSTRAINT accuracy_reports_reporter_fk;

ALTER TABLE accuracy_reports
    ADD CONSTRAINT accuracy_reports_reporter_fk
        FOREIGN KEY (reporter_user_id) REFERENCES users (user_id) ON DELETE SET NULL;
