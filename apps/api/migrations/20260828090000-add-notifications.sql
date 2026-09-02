-- Telling somebody that something happened.
--
-- A notification is a small piece of text that travels further than the thing
-- it describes — sometimes onto a lock screen — so these tables are built
-- around what they deliberately cannot hold. There is no column here for a
-- name, a caption, a comment, or a thumbnail. `notifications.md:238` lists what
-- a notification can disclose even when the underlying resource is protected,
-- and the answer taken here is to store identifiers and compose the wording at
-- read time from what the reader may currently see.
--
-- Two things follow. A privacy change needs no propagation into these rows,
-- because nothing sensitive was ever copied out of the domain. And a
-- notification about something the reader can no longer see simply does not
-- render, so it is absent rather than blanked.

CREATE TABLE notifications (
    notification_id   uuid        PRIMARY KEY,

    -- Who hears about it.
    recipient_user_id uuid        NOT NULL,

    -- What happened, as a stable vocabulary. This is the part that does not
    -- change and is not sensitive — the hybrid `notifications.md:387` asks for,
    -- resolved towards the safe end.
    type              text        NOT NULL,

    -- Which family it belongs to. Categories carry different delivery rules and
    -- different preference controls, and one of them cannot be switched off.
    category          text        NOT NULL,

    -- What it is about, and how to reauthorize it when somebody opens it. A
    -- deep link is a pointer and never a permission.
    source_type       text        NOT NULL,
    source_id         uuid        NOT NULL,

    -- The Moment whose visibility decides whether this may still be shown.
    --
    -- An identifier rather than content, so it costs nothing this design cares
    -- about. It exists because a notification's source is not always the thing
    -- that governs access to it: a mention points at a comment, and what
    -- decides whether the comment may be seen is the Moment it sits under.
    -- Without this the mention outlived the Moment becoming private, which is
    -- exactly the kind of leak a notification makes easiest.
    --
    -- Null where nothing governs it — somebody followed you, your own upload.
    via_moment_id     uuid,

    -- What collapses together. Unread activity of one kind about one thing is
    -- one entry; reading it starts a new one.
    aggregation_key   text        NOT NULL,

    created_at        timestamptz NOT NULL DEFAULT now(),
    read_at           timestamptz,
    dismissed_at      timestamptz,

    CONSTRAINT notifications_category_check
        CHECK (category IN ('social', 'media', 'moderation')),

    CONSTRAINT notifications_source_type_check
        CHECK (source_type IN ('moment', 'comment', 'user', 'upload')),

    CONSTRAINT notifications_recipient_fk
        FOREIGN KEY (recipient_user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- One unread entry per thing per kind.
--
-- Partial, so reading an entry frees the key and the next activity starts a
-- fresh one. Enforced here rather than in the generator because two messages
-- about the same Moment can be handled at the same instant by two instances of
-- a consumer group, and a rule somebody has to remember is not a rule.
CREATE UNIQUE INDEX notifications_one_unread_per_key
    ON notifications (aggregation_key)
    WHERE read_at IS NULL AND dismissed_at IS NULL;

-- Somebody's notifications, newest first, which is every read this table serves.
CREATE INDEX notifications_recipient_idx
    ON notifications (recipient_user_id, created_at DESC, notification_id DESC);

-- The unread count, which is asked for far more often than the list itself.
CREATE INDEX notifications_unread_idx
    ON notifications (recipient_user_id)
    WHERE read_at IS NULL AND dismissed_at IS NULL;

-- Who contributed to one notification.
--
-- Separate from the notification so that "three people reacted" can name them
-- at read time to a reader entitled to know who they are, and count them to one
-- who is not. Storing a rendered string instead would have to choose one of
-- those at write time, before anybody knows who is asking.
CREATE TABLE notification_actors (
    notification_id uuid        NOT NULL,
    actor_user_id   uuid        NOT NULL,

    acted_at        timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (notification_id, actor_user_id),

    CONSTRAINT notification_actors_notification_fk
        FOREIGN KEY (notification_id) REFERENCES notifications (notification_id)
            ON DELETE CASCADE,

    CONSTRAINT notification_actors_actor_fk
        FOREIGN KEY (actor_user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE INDEX notification_actors_by_notification_idx
    ON notification_actors (notification_id, acted_at DESC);

-- Which messages have already been turned into notifications.
--
-- Deduplication lives here rather than on the actor row, and the reason is a
-- notification that has no actor: a moderation decision tells somebody what was
-- done to their content and deliberately never says which moderator did it,
-- because 5N keeps reviewer identity out of what the affected person sees.
-- Hanging deduplication off the actor would have meant either inventing an
-- actor for those or leaving them undeduplicated.
--
-- Keyed with the recipient because one message can legitimately notify several
-- people — a comment naming two of them — and each of those is a separate
-- notification that must survive independently.
CREATE TABLE notification_source_events (
    source_event_id   uuid        NOT NULL,
    recipient_user_id uuid        NOT NULL,
    handled_at        timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (source_event_id, recipient_user_id),

    CONSTRAINT notification_source_events_recipient_fk
        FOREIGN KEY (recipient_user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- What somebody wants to hear about, and how.
--
-- Absence means yes. `notifications.md:465` names category, channel, and type
-- as the dimensions; category and channel are here, and type is deliberately
-- not — a preference per notification type is a settings screen nobody can
-- read, which the same section warns against.
--
-- The channel column exists before there is more than one channel, because the
-- delivery half of this phase needs it the moment it starts and adding it later
-- means migrating live preference data.
CREATE TABLE notification_preferences (
    user_id    uuid        NOT NULL,
    category   text        NOT NULL,
    channel    text        NOT NULL,
    enabled    boolean     NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, category, channel),

    CONSTRAINT notification_preferences_category_check
        CHECK (category IN ('social', 'media', 'moderation')),

    CONSTRAINT notification_preferences_channel_check
        CHECK (channel IN ('in_app', 'email', 'push')),

    CONSTRAINT notification_preferences_user_fk
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);
