-- add-derivatives
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- What has been produced from an upload, for showing it.

-- Which derivatives exist for this upload.
--
-- Recorded so that something displaying media knows what is available without
-- guessing at key names. Derivatives are for delivery and never authoritative:
-- the original is always kept and never altered, so anything here can be
-- produced again if the sizes or formats change.
ALTER TABLE uploads
    ADD COLUMN derivatives text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN derived_at  timestamptz;
