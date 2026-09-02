-- add-location-provenance
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- How a place came to be known.

-- Not all sources carry the same authority. "Madison Square Garden, typed in by
-- the person who was there" and "Madison Square Garden, read out of a
-- photograph's metadata" are different claims, and a record holding only the
-- name has already thrown the difference away.
--
-- Every place recorded before this column existed was chosen by hand from a
-- search: nothing else could create one yet. So the backfill states a fact
-- rather than guessing at one.
ALTER TABLE locations
    ADD COLUMN source text NOT NULL DEFAULT 'explicit-selection';

-- The default exists to fill the rows already there. Leaving it in place would
-- let a later insert quietly claim the strongest provenance by saying nothing,
-- which is exactly the failure this column exists to prevent.
ALTER TABLE locations
    ALTER COLUMN source DROP DEFAULT;

ALTER TABLE locations
    ADD CONSTRAINT locations_source_is_known CHECK (
        source IN ('explicit-selection', 'device-location', 'media-metadata')
    );
