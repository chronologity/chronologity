-- index-comments-by-moment
--
-- Counting a discussion should not read every comment in the database.
--
-- `moment_comments` carries two indexes leading on the columns a page needs, and
-- both are partial: one `WHERE thread_comment_id IS NULL` for top-level comments,
-- one `WHERE thread_comment_id IS NOT NULL` for replies. A count deliberately
-- includes replies, so it constrains `thread_comment_id` in neither direction and
-- neither index applies. There was nothing on `moment_id` alone.
--
-- Measured before this migration, on six hundred thousand comments: a Parallel
-- Seq Scan removing 199,460 rows per worker to return a count of about sixteen
-- hundred, 9,380 buffers, 47 ms. Its cost is a function of how much the whole
-- product has ever said, not of how long the conversation being counted is — and
-- the count is a field on a connection, so a page asking ten Moments for their
-- totals paid it ten times.
--
-- ADR-142 found this and left it as prose, because the fix is a write-side change
-- for a read-side need. Prose does not decay into action; ADR-147 measured it.

-- Partial on `deleted_at IS NULL` because every reader of this table carries that
-- predicate, which keeps the index off rows nothing counts.
--
-- Deliberately not CREATE INDEX CONCURRENTLY: each migration in this repository
-- runs inside its own transaction alongside the row recording it, and a
-- concurrent build cannot run in one. That means this takes a lock that blocks
-- writes to `moment_comments` for as long as the build takes — negligible at
-- today's size, and worth knowing before the table is large.
CREATE INDEX moment_comments_moment_idx
    ON moment_comments (moment_id)
 WHERE deleted_at IS NULL;
