-- Somewhere to look things up.
--
-- Derived, disposable, rebuildable state (`search.md` invariant 1). Nothing here
-- is authoritative for anything: every column is a copy of something a domain
-- table already owns, kept so that finding is possible without scanning history.
-- A recording succeeds whether or not it is searchable yet.

-- Typo tolerance, prefix matching, and alias lookup. Postgres has no PostGIS
-- here, so coarse geography uses truncated geohash columns instead — the bounded
-- alternative `search.md:96` offers.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- One document per entity, per index version.
--
-- Versions live side by side rather than in separate tables (`search.md:186`):
-- a rebuild of `search-v2` runs to completion while `search-v1` still serves
-- reads, and cutover is the read path changing which version it asks for. A
-- defective version is deleted rather than repaired, because nothing depends on
-- it that cannot be rebuilt.
CREATE TABLE search_documents (
    -- Part of the key, not a filter. Two versions of the same entity are two
    -- rows, and neither can overwrite the other by accident.
    index_version      text        NOT NULL,

    -- `moment`, `user`, `event`, or `location`.
    --
    -- No `timeline`. `search.md:114` lists one; `glossary.md:477` says a
    -- Timeline "is never stored, owned, or followed directly" and so has no
    -- identity to key a document on. What people search for is the Historical
    -- Context — an Event or a Location — which is what an interface presents as
    -- a Timeline.
    entity_type        text        NOT NULL,

    -- Stable Chronologity identity, independent of names, aliases, and any
    -- external geocoder or search-provider identifier (`search.md` invariant
    -- 10). A rename never changes it, so indexing twice is idempotent.
    entity_id          uuid        NOT NULL,

    -- Weighted separately so a name match can outrank a body match. Title
    -- carries what the thing is called; body carries what it says; aliases
    -- carry what it has also been called, which for historical Events is not a
    -- nicety.
    title              text        NOT NULL DEFAULT '',
    body               text        NOT NULL DEFAULT '',
    aliases            text        NOT NULL DEFAULT '',

    -- Maintained by the writer rather than generated, because the weights are
    -- part of the index version: changing them is a new version built beside
    -- the old one, not an in-place redefinition of a stored column.
    search_vector      tsvector    NOT NULL,

    -- The occurrence interval and how well it is known, carried exactly as a
    -- Moment carries it. Null for a User and a Location, which are not
    -- occurrences. Keeping the precision is what lets a temporal filter avoid
    -- inventing a day for a summer nobody dated more precisely.
    occurrence_start   timestamptz,
    occurrence_end     timestamptz,
    occurrence_precision text,

    published_at       timestamptz,

    -- Intrinsic eligibility: what is true of the resource regardless of who is
    -- asking (`search.md:225`). The viewer-dependent half — blocks, age, the
    -- requesting surface — is resolved at query time and is deliberately absent.
    visibility         text        NOT NULL DEFAULT 'public',

    -- A separate dimension from visibility (`search.md:243`). Public
    -- accessibility does not imply broad indexing, and Search eligibility may
    -- be stricter than direct access where safety requires it.
    searchable         boolean     NOT NULL DEFAULT true,

    moderation_state   text        NOT NULL DEFAULT 'allowed',
    deleted            boolean     NOT NULL DEFAULT false,

    -- Not eligibility itself. It is what lets the query path resolve blocking
    -- and suspension against one column instead of joining back through four
    -- content tables. Null where an entity has no author: an Event is shared
    -- history and a Location is reference data.
    author_user_id     uuid,

    -- Coarse geography, most precise first. Truncated geohashes rather than
    -- points, so a query can retrieve by area without the index holding a
    -- position more exact than a Viewer is entitled to.
    geohash_exact      text,
    geohash_coarse     text,
    geohash_region     text,

    significance         double precision,
    significance_version text,

    -- Per-field origin: `authored`, `structured`, or `derived`
    -- (`search.md:141`). `inferred` is reserved and never written — the space
    -- exists so introducing OCR or transcripts later does not need a document
    -- migration that blurs the line between what somebody wrote and what a
    -- model guessed.
    provenance         jsonb       NOT NULL DEFAULT '{}'::jsonb,

    -- When this document was built from authoritative state. The regression
    -- guard: a slower writer holding an older reading must not overwrite a
    -- newer document, which is possible whenever a rebuild runs beside the
    -- indexer.
    built_at           timestamptz NOT NULL DEFAULT now(),

    -- Which message produced it, for tracing a document back to its cause.
    source_event_id    uuid,

    indexed_at         timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (index_version, entity_type, entity_id),

    CONSTRAINT search_documents_entity_type_check
        CHECK (entity_type IN ('moment', 'user', 'event', 'location')),

    CONSTRAINT search_documents_visibility_check
        CHECK (visibility IN ('public', 'restricted', 'private')),

    CONSTRAINT search_documents_precision_check
        CHECK (occurrence_precision IS NULL
               OR occurrence_precision IN ('instant', 'day', 'month', 'year')),

    -- An interval that runs backwards would silently drop out of every range
    -- query rather than failing, which is the worst way for it to be wrong.
    CONSTRAINT search_documents_occurrence_order_check
        CHECK (occurrence_start IS NULL
               OR occurrence_end IS NULL
               OR occurrence_start <= occurrence_end)
);

-- Lexical relevance.
CREATE INDEX search_documents_vector_idx
    ON search_documents USING GIN (search_vector);

-- Typo tolerance and prefix matching, which is what makes an exact-name lookup
-- survive somebody misspelling the name.
CREATE INDEX search_documents_title_trgm_idx
    ON search_documents USING GIN (title gin_trgm_ops);

CREATE INDEX search_documents_aliases_trgm_idx
    ON search_documents USING GIN (aliases gin_trgm_ops);

-- The retrieval shape: eligible documents of one type, in occurrence order.
-- Eligibility leads because it is a filter applied before ranking, never after
-- (`search.md:247`).
CREATE INDEX search_documents_retrieval_idx
    ON search_documents (index_version, entity_type, searchable, deleted,
                         moderation_state, visibility, occurrence_start DESC,
                         entity_id);

-- Everything one account authored, for the sweep that follows a suspension.
CREATE INDEX search_documents_author_idx
    ON search_documents (index_version, author_user_id)
    WHERE author_user_id IS NOT NULL;

-- Coarse geographic retrieval.
CREATE INDEX search_documents_geohash_idx
    ON search_documents (index_version, geohash_coarse)
    WHERE geohash_coarse IS NOT NULL;
