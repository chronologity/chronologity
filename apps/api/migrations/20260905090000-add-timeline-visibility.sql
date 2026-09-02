-- Whether somebody's Timeline may be opened by other people.
--
-- Not a rule about Moments. A person's Timeline can only ever show Moments the
-- Viewer could already open one at a time, so this decides whether the
-- **chronological aggregate** is offered — not whether anything is visible.
--
-- That distinction is the whole reason it exists. Moments made public one by
-- one are a different disclosure from a walkable record of where somebody was
-- and when, and choosing the first is not consent to the second.
--
-- Open by default, matching the product's own posture: a Moment is public
-- unless its author says otherwise (`moments.md:587`), and follow approval is
-- off unless somebody turns it on. `privacy.md:82` requires that a default
-- never retroactively change what was promised, and nothing is promised here
-- yet — no Timeline of anybody's has ever been readable by another person.
ALTER TABLE user_preferences
    ADD COLUMN timeline_is_public boolean NOT NULL DEFAULT true;
