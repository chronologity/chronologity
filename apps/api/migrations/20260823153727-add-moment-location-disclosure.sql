-- How much of a Moment's place other people are told.
--
-- Separate from the Location's own `precision`, and deliberately not the same
-- axis. Precision says how well anybody knows where something happened and is a
-- fact about history; disclosure says how much of that a given Viewer receives
-- and is the author's privacy choice. A place known exactly may still be
-- disclosed as a city, and a place known only to the city is `broad` for
-- everybody including its author.
--
-- The author always receives the exact place regardless of this column. It
-- governs what everybody else receives.
ALTER TABLE moments
    ADD COLUMN location_disclosure text NOT NULL DEFAULT 'exact';

ALTER TABLE moments
    ADD CONSTRAINT moments_location_disclosure_is_known CHECK (
        location_disclosure IN ('exact', 'neighbourhood', 'city', 'hidden')
    );
