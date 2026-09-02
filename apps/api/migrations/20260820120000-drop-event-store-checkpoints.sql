-- drop-event-store-checkpoints
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Schema belonging to code that no longer exists. Both tables record a position
-- in an EventStoreDB stream, and there is no such stream to hold a position in
-- (ADR-092, ADR-093).

-- How far the EventStoreDB-to-Kafka publisher had read. The outbox publisher
-- that replaced it claims rows with FOR UPDATE SKIP LOCKED and keeps no
-- checkpoint at all, which is what lets several instances run at once.
DROP TABLE IF EXISTS publisher_checkpoints;

-- How far a projection had read `$all`. A projection now reads Kafka, where
-- progress is a consumer group's offsets rather than a global position this
-- table could hold — so the replacement is not a narrower version of this, and
-- keeping it would invite something to record the wrong kind of progress in it.
DROP TABLE IF EXISTS projection_checkpoints;

-- `projection_processed_events` deliberately stays. Recognising work already
-- done is a property of at-least-once delivery rather than of any particular
-- transport, and Kafka redelivers exactly as the event store did.
