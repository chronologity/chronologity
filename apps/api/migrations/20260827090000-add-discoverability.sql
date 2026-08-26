-- Whether a Moment may be offered to somebody who did not ask for it.
--
-- A state of its own, not a reading of visibility. `discovery.md:157` says the
-- product model "should not equate public accessibility with recommendation
-- consent": a Moment can be reachable by anybody holding the link and still be
-- something its author never wanted put in front of strangers.
--
--     public + discoverable  ->  may be recommended
--     public + unlisted      ->  reachable, never recommended
--     restricted / private   ->  never recommended
ALTER TABLE moments
    ADD COLUMN discoverable boolean NOT NULL DEFAULT true;

-- Default true, matching the default-public decision (ADR-108): a Moment its
-- author chose to make public is offered unless they say otherwise. The
-- distinction the document asks for is preserved by the state existing and
-- being separately controllable, not by making the default inconvenient — and
-- the floors that actually protect people are in the eligibility rule, where no
-- default can lift them.

COMMENT ON COLUMN moments.discoverable IS
    'Whether this Moment may be recommended to somebody who did not ask for it. Separate from visibility: unlisting leaves it reachable by link.';

-- The same flag in the Search index, so discovery eligibility stays one query
-- rather than a join back to authoritative state for every candidate.
ALTER TABLE search_documents
    ADD COLUMN discoverable boolean NOT NULL DEFAULT true;

-- The retrieval shape for a recommendation surface: eligible, discoverable
-- Moments in significance order. Eligibility leads because it is a filter
-- applied before ranking, never after.
CREATE INDEX search_documents_discovery_idx
    ON search_documents (index_version, entity_type, discoverable, searchable,
                         deleted, moderation_state, visibility,
                         significance DESC NULLS LAST, entity_id);
