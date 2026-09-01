-- add-moment-id-skip-index
--
-- Finding a Moment by its identifier, without reading the whole table.
--
-- Both projection tables are ordered by when history happened, which is what a
-- Timeline reads by. But every write asks a different question first — "do you
-- already hold this Moment?" — and `moment_id` leads neither sort key, so
-- answering it meant scanning every partition. Once per Moment, over everything
-- written so far, which made a rebuild cost the square of the corpus: brisk at
-- the start, crawling by the end, and eventually a single statement outliving
-- the client's timeout.
--
-- Batching cut how often that question is asked, from once a Moment to once a
-- page. This stops each asking being a full scan, so the cost stops growing with
-- the corpus rather than merely being paid less often.
--
-- A bloom filter because the predicate is exact-match on a high-cardinality
-- string: `minmax` says nothing about identifiers unordered relative to the sort
-- key, and a `set` index would be as large as the column it indexes.
--
-- It serves every write-path predicate naming a `moment_id` — the batch probes,
-- the batch deletes, `holds`, `remove`, `removeContexts`, and the erasure family.
-- It does **not** help the read path: `withMoments` joins on `moment_id` with no
-- constant to test, so ClickHouse scans the right-hand table to build the hash
-- side whatever indexes exist.
--
-- `ADD INDEX` only, deliberately. It applies to parts written from now on, which
-- is exactly the flow this serves: a rebuild into a fresh version writes nothing
-- but new parts. Materialising it across parts that already exist is
-- `ALTER TABLE ... MATERIALIZE INDEX`, an asynchronous mutation that rewrites
-- every one of them — unbounded work that a migration must not start and would
-- return long before finishing. An operator with a large live version who wants
-- it there before cutting over should run that by hand.
ALTER TABLE timeline_moments
    ADD INDEX IF NOT EXISTS timeline_moments_moment_idx moment_id TYPE bloom_filter(0.01) GRANULARITY 1;

ALTER TABLE timeline_moment_contexts
    ADD INDEX IF NOT EXISTS timeline_moment_contexts_moment_idx moment_id TYPE bloom_filter(0.01) GRANULARITY 1;
