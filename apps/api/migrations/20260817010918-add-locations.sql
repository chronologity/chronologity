-- add-locations
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Locations: places, as they were recorded.

-- The Location read model.
--
-- A place is not a coordinate. The name here is what the place was called when
-- someone recorded it, and no later lookup rewrites it — that is what lets a
-- photograph from 1950 keep the name of the building that stood there then.
CREATE TABLE locations (
    location_id       uuid        PRIMARY KEY,
    recorded_by_user_id uuid      NOT NULL,

    name              text        NOT NULL,

    -- Null when the position is unknown, which is legitimate history rather
    -- than missing data. Stored as two numbers rather than a geography type:
    -- nothing yet asks a spatial question, and adding PostGIS for columns that
    -- are only read back would be infrastructure ahead of need.
    latitude          double precision,
    longitude         double precision,

    -- How precisely the position is actually known: exact, approximate, broad,
    -- or unknown. Recorded rather than inferred from decimal places, which say
    -- nothing about confidence.
    precision         text        NOT NULL,

    -- The wider areas the place sat inside, as recorded. Flat text rather than
    -- references to other Locations, because administrative boundaries change
    -- and a trail crosses several jurisdictions; this records context, and does
    -- not claim to describe geography.
    neighbourhood     text,
    city              text,
    region            text,
    country           text,
    country_code      char(2),

    -- Where in the map service this came from, as `type:id`. Provenance, never
    -- identity. Null for a place no service knows.
    source_reference  text,

    created_at        timestamptz NOT NULL,
    updated_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT locations_position_matches_precision CHECK (
        (precision = 'unknown' AND latitude IS NULL AND longitude IS NULL)
        OR (precision <> 'unknown' AND latitude IS NOT NULL AND longitude IS NOT NULL)
    )
);

-- Choosing the same search result twice should reach the same place rather
-- than creating a second one. Partial, because places with no service behind
-- them have no reference to share.
CREATE UNIQUE INDEX locations_source_reference_idx
    ON locations (source_reference)
    WHERE source_reference IS NOT NULL;

CREATE INDEX locations_recorded_by_idx ON locations (recorded_by_user_id, created_at DESC);
