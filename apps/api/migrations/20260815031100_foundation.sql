-- Foundational tables for asynchronous publication and projection progress.
--
-- Nothing here is domain state. These tables exist so that authoritative
-- changes can reach Kafka exactly once from the writer's point of view, and so
-- that derived state can record how far it has processed.

-- Integration events awaiting publication (ADR-016).
--
-- A row is written in the same transaction as the state change that produced
-- it, which is what removes the dual-write failure between PostgreSQL and
-- Kafka. Publication is asynchronous and at-least-once.
CREATE TABLE outbox_messages (
    id              uuid PRIMARY KEY,
    topic           text        NOT NULL,
    partition_key   text        NOT NULL,
    event_type      text        NOT NULL,
    event_version   integer     NOT NULL,
    payload         jsonb       NOT NULL,
    metadata        jsonb       NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    published_at    timestamptz,
    attempts        integer     NOT NULL DEFAULT 0,
    last_error      text
);

-- Publication scans only unpublished rows, and they are the small minority
-- once the table has any history.
CREATE INDEX outbox_messages_unpublished_idx
    ON outbox_messages (created_at)
    WHERE published_at IS NULL;

-- How far a projection has processed its source.
--
-- The projection name carries its version (`timeline-v1`), so a rebuilt
-- version tracks its own progress side by side with the one still serving
-- reads (ADR-018).
CREATE TABLE projection_checkpoints (
    projection_name text        PRIMARY KEY,
    source          text        NOT NULL,
    position        bigint      NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Events a projection has already applied.
--
-- At-least-once delivery guarantees redelivery, so idempotency cannot be
-- optional. Recording the event identifier alongside the projection lets a
-- projection recognise work it has already done.
CREATE TABLE projection_processed_events (
    projection_name text        NOT NULL,
    event_id        uuid        NOT NULL,
    processed_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (projection_name, event_id)
);

-- How far the EventStoreDB-to-Kafka publisher has read (ADR-015).
CREATE TABLE publisher_checkpoints (
    publisher_name text        PRIMARY KEY,
    position       bigint      NOT NULL,
    updated_at     timestamptz NOT NULL DEFAULT now()
);
