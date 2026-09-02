-- Uploads are listed newest first, and two registered in the same millisecond
-- are ordinary: a phone handing over a burst produces them. Ordering on the
-- moment alone would let a row be skipped or repeated at a page boundary, so
-- the identifier settles the tie and the index has to carry it.
--
-- The same correction ADR-105 made for following, applied to the last list
-- that was still paging without a tie-breaker.
DROP INDEX IF EXISTS uploads_owner_idx;

CREATE INDEX uploads_owner_idx ON uploads (owner_user_id, registered_at DESC, upload_id DESC);
