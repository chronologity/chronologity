-- add-outbox-abandonment
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Setting aside an outbox message the broker will never accept.

-- When this message was given up on.
--
-- Null for every message that is pending or published, which is nearly all of
-- them. Set when a message has failed enough times that retrying it is no
-- longer plausibly useful.
--
-- This exists because a batch publishes as one unit: one message the broker
-- permanently refuses fails its whole batch, and the batch is re-claimed
-- oldest-first forever. Without a way to set that message aside the outbox
-- does not merely retry it — it stops, and nothing behind it is ever
-- published.
--
-- Recorded as a moment rather than inferred from the attempt count, so giving
-- up is a fact an operator can find and reverse. Clearing this column returns
-- the message to the queue, which is what to do once the reason it was
-- refused has been fixed.
ALTER TABLE outbox_messages
    ADD COLUMN abandoned_at timestamptz;

-- The publisher claims pending work through this index, and an abandoned
-- message is no longer pending. Left as it was, every claim would scan past
-- the abandoned rows accumulating at the front of the queue.
DROP INDEX outbox_messages_unpublished_idx;

CREATE INDEX outbox_messages_unpublished_idx
    ON outbox_messages (created_at)
    WHERE published_at IS NULL AND abandoned_at IS NULL;

-- Small, and read by operators rather than by the publisher: what has been
-- given up on, and why.
CREATE INDEX outbox_messages_abandoned_idx
    ON outbox_messages (abandoned_at)
    WHERE abandoned_at IS NOT NULL;
