-- The outbox is a queue, not a record. Published rows are swept once they are
-- old enough to be of no further use, so the table does not grow without bound
-- and payloads describing people are not kept indefinitely for no reason.
--
-- The existing index covers unpublished rows only, which is the opposite of
-- what a sweep scans. This one is equally narrow in the other direction, and
-- once sweeping keeps up it stays small.
CREATE INDEX outbox_messages_published_idx
    ON outbox_messages (published_at)
    WHERE published_at IS NOT NULL;
