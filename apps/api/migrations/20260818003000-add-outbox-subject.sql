-- add-outbox-subject
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- What each outbox message is about.

-- The Kafka envelope names the entity an event concerns, and the outbox had no
-- column carrying it: the previous publisher recovered it by parsing the
-- EventStoreDB stream name, which no longer exists (ADR-093).
--
-- Every other envelope field already maps from a column — the identifier, the
-- event type and version, the payload, and the correlation, causation, actor
-- and timestamp inside `metadata`. This closes the last gap.
--
-- Backfilled to 'unknown' rather than left null. The table is empty in every
-- environment, because nothing has ever enqueued a message; the default exists
-- so the statement is safe wherever that turns out not to be true, and is
-- dropped immediately afterwards so a later insert cannot stay silent about
-- what it is publishing.
ALTER TABLE outbox_messages
    ADD COLUMN aggregate_type text NOT NULL DEFAULT 'unknown',
    ADD COLUMN aggregate_id uuid,
    -- Where the entity carries a version for optimistic concurrency, this is
    -- that version, so a consumer can tell an older message from a newer one
    -- about the same thing. Zero where it carries none.
    ADD COLUMN aggregate_version integer NOT NULL DEFAULT 0;

UPDATE outbox_messages
   SET aggregate_id = id::uuid
 WHERE aggregate_id IS NULL;

ALTER TABLE outbox_messages
    ALTER COLUMN aggregate_id SET NOT NULL,
    ALTER COLUMN aggregate_type DROP DEFAULT,
    ALTER COLUMN aggregate_version DROP DEFAULT;
