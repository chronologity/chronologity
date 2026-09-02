-- add-following
--
-- Being told when what you follow has grown.
--
-- Saved Views already tell somebody what is new when they look. This is the
-- other half: hearing about it without having to.

-- Whether a view's owner wants to hear about it.
--
-- A boolean on the view rather than a table, because a view has exactly one
-- owner and therefore exactly one possible follower. A join table would model a
-- relationship that cannot have more than one row.
--
-- `saved-views.md` distinguishes the two acts plainly: saving means "keep this
-- perspective so I can return to it", following means "keep it and surface
-- meaningful changes to it". So this defaults to false — somebody who saved a
-- view asked for the first thing, and reading the second into it would start
-- notifying people who never said yes.
ALTER TABLE saved_views
    ADD COLUMN IF NOT EXISTS followed boolean NOT NULL DEFAULT false;

-- Only followed views are ever swept for notifications, and there are far fewer
-- of them than views.
CREATE INDEX IF NOT EXISTS saved_views_followed_idx
    ON saved_views (saved_view_id) WHERE followed;

-- What a notification may be about.
--
-- Three new sources, one per thing that can be followed. A saved view is
-- followed by its owner; a Location and a real-world Event are shared history
-- anybody may follow, which `glossary.md` already admits and which until now
-- was recorded and consumed by nothing.
ALTER TABLE notifications
    DROP CONSTRAINT notifications_source_type_check;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_source_type_check
        CHECK (source_type IN (
            'moment', 'comment', 'user', 'upload', 'participation',
            'saved_view', 'location', 'real_world_event'
        ));

-- Notifications about history itself are their own kind.
--
-- Not social, which is the category for what people do to each other's Moments.
-- These say the *representation* of history has expanded — somebody added a
-- photograph of 1994 to a place you follow — and `saved-views.md` is explicit
-- that new-Moment awareness "should not imply that the underlying historical
-- subject itself changed".
--
-- Silenceable, unlike moderation and security. Somebody who follows a busy
-- Location and finds it noisy must be able to stop hearing about it without
-- also losing the notification that says their account was accessed.
ALTER TABLE notifications
    DROP CONSTRAINT notifications_category_check;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check
        CHECK (category IN (
            'social', 'media', 'moderation', 'security', 'participation', 'history'
        ));

-- And the preferences table, which carries its own copy of the vocabulary. A
-- category the notifications table accepts but preferences reject is one nobody
-- can turn off — which for a category attached to a busy public place would be
-- the worst one to lose.
ALTER TABLE notification_preferences
    DROP CONSTRAINT notification_preferences_category_check;

ALTER TABLE notification_preferences
    ADD CONSTRAINT notification_preferences_category_check
        CHECK (category IN (
            'social', 'media', 'moderation', 'security', 'participation', 'history'
        ));
