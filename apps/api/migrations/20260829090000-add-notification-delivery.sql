-- Carrying a notification out of the building.
--
-- 5Q-1 decided that a notification exists and who may see it. Nothing carried
-- it anywhere: somebody learned their upload had failed only by opening the
-- application, which is backwards for the one category where being told is the
-- point. These three tables are the difference between a notification existing
-- and somebody hearing about it.
--
-- The mistakes available here are not the mistakes 5Q-1 could make. Those were
-- privacy mistakes; these are credentials in a log file, a retry loop that
-- never stops, and arithmetic that wakes somebody at three in the morning
-- because a time zone was read as an offset.

-- A device push can reach.
--
-- `architecture/notifications.md:857` calls device tokens sensitive operational
-- credentials, and that is exactly what they are: anybody holding one can send
-- to that device. Three things follow, and all three are structural rather than
-- matters of care.
--
-- The token lives here and in no other table, so there is one place to erase.
-- No outbound contract has a field it could occupy, so no profile read can
-- return it by accident. And a row is retired rather than deleted, so a
-- provider rejection stays distinguishable from a device that was never
-- registered — which is the difference between "this token is dead" and "this
-- token is someone else's now".
CREATE TABLE notification_devices (
    device_id      uuid        PRIMARY KEY,
    user_id        uuid        NOT NULL,

    platform       text        NOT NULL,

    -- The provider credential. Never logged, never returned, never joined into
    -- anything a client reads.
    token          text        NOT NULL,

    -- What to call it in a list of devices. Cosmetic, and never used to decide
    -- where anything goes.
    label          text,

    status         text        NOT NULL DEFAULT 'active',

    registered_at  timestamptz NOT NULL DEFAULT now(),

    -- Moved forward whenever the same token is registered again, which is what
    -- a client does on every launch. A device that stops doing so has been
    -- uninstalled, and this is how that becomes visible without a provider
    -- telling us.
    last_seen_at   timestamptz NOT NULL DEFAULT now(),

    invalidated_at timestamptz,

    CONSTRAINT notification_devices_platform_check
        CHECK (platform IN ('ios', 'android', 'web')),

    CONSTRAINT notification_devices_status_check
        CHECK (status IN ('active', 'invalidated')),

    -- A retired row says when it was retired, and an active one does not. Kept
    -- as a constraint because the dispatcher reads the status and the erasure
    -- work in 5R will read the timestamp, and the two disagreeing would be a
    -- device that is either delivered to forever or erased twice.
    CONSTRAINT notification_devices_invalidated_check
        CHECK ((status = 'invalidated') = (invalidated_at IS NOT NULL)),

    CONSTRAINT notification_devices_user_fk
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- One live registration per token, whoever holds it.
--
-- Partial, over active rows only, so a retired registration does not block the
-- same physical device coming back. It exists because a phone can be handed to
-- somebody else: the new owner signs in, registers the same token, and
-- `architecture/notifications.md:912` requires that the previous account stops
-- receiving. Enforced here rather than remembered, because the alternative is
-- two accounts' private notifications arriving on one lock screen.
CREATE UNIQUE INDEX notification_devices_one_active_per_token
    ON notification_devices (token)
    WHERE status = 'active';

-- Everywhere a push would go, which is the only read the dispatcher makes here.
CREATE INDEX notification_devices_active_idx
    ON notification_devices (user_id)
    WHERE status = 'active';

-- One notification's journey down one channel.
--
-- Attempts are a counter and a last error rather than a row each. That is the
-- shape the outbox already uses and has been proven with, and the per-attempt
-- table `architecture/notifications.md:770` sketches would buy a history nobody
-- reads at the cost of a second table growing at delivery rate.
--
-- `due_at` is the whole of quiet hours and digests. Rather than the dispatcher
-- asking on every pass whether now is a good time for this person, the answer
-- is computed once when the delivery is created, in the account's own time
-- zone, and written down. A dispatcher that only ever asks "is this due yet"
-- cannot get somebody's time zone wrong, because it never looks at one.
CREATE TABLE notification_deliveries (
    delivery_id       uuid        PRIMARY KEY,
    notification_id   uuid        NOT NULL,

    -- Denormalised from the notification so a digest can be gathered by
    -- recipient without joining, and so the claim query stays one index scan.
    recipient_user_id uuid        NOT NULL,

    channel           text        NOT NULL,

    -- Decided when the delivery is created, not when it is sent. A digest that
    -- was scheduled as a digest is gathered with its siblings; an immediate one
    -- is sent alone even if it happens to come due beside another. Without
    -- this, two immediate notifications landing in the same second would be
    -- silently merged into a digest nobody asked for.
    mode              text        NOT NULL,

    status            text        NOT NULL DEFAULT 'pending',

    due_at            timestamptz NOT NULL,

    attempts          integer     NOT NULL DEFAULT 0,

    -- Why it last failed, in this system's vocabulary rather than a provider's.
    -- `transient` is retried and `permanent` is not, which is the distinction
    -- `architecture/notifications.md:820` draws and the only one that changes
    -- what happens next.
    error_category    text,
    last_error        text,

    created_at        timestamptz NOT NULL DEFAULT now(),
    completed_at      timestamptz,

    CONSTRAINT notification_deliveries_channel_check
        CHECK (channel IN ('email', 'push')),

    CONSTRAINT notification_deliveries_mode_check
        CHECK (mode IN ('immediate', 'digest')),

    -- `cancelled` is not a failure. It is what happens when the notification
    -- stopped being something the recipient may see between its creation and
    -- its sending — a Moment made private while an email sat in the queue.
    -- `abandoned` is the retry ceiling, kept distinct from `failed` so an
    -- operator can tell a provider refusing once from a provider unreachable
    -- for a day.
    CONSTRAINT notification_deliveries_status_check
        CHECK (status IN ('pending', 'sent', 'failed', 'abandoned', 'cancelled')),

    CONSTRAINT notification_deliveries_error_category_check
        CHECK (error_category IS NULL OR error_category IN ('transient', 'permanent')),

    -- Anything not pending is finished, and a finished delivery says when.
    CONSTRAINT notification_deliveries_completed_check
        CHECK ((status = 'pending') = (completed_at IS NULL)),

    CONSTRAINT notification_deliveries_notification_fk
        FOREIGN KEY (notification_id) REFERENCES notifications (notification_id)
            ON DELETE CASCADE,

    CONSTRAINT notification_deliveries_recipient_fk
        FOREIGN KEY (recipient_user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- One delivery per notification per channel.
--
-- This is what makes the whole path idempotent, and it does so without anybody
-- remembering to check. A notification aggregates while unread — three people
-- reacting to one Moment is one entry — so the second and third arrivals find
-- this index and open no second email. At-least-once delivery from the broker
-- lands on it too.
CREATE UNIQUE INDEX notification_deliveries_one_per_channel
    ON notification_deliveries (notification_id, channel);

-- What the dispatcher claims, and the only query it runs to find work.
CREATE INDEX notification_deliveries_due_idx
    ON notification_deliveries (due_at, delivery_id)
    WHERE status = 'pending';

-- When a channel delivers, as opposed to whether it delivers at all.
--
-- Two questions that look alike and are not. `notification_preferences` says
-- whether to tell somebody; this says when, and can only ever delay. A required
-- notification still arrives — it arrives when the quiet window ends rather
-- than never — which is what keeps `product/notifications.md:533` true: quiet
-- hours affect delivery time only.
--
-- There is no time zone column. It is read from `user_preferences`, where the
-- account already keeps one, because a time zone stored twice is a time zone
-- that will disagree with itself the first time somebody moves.
CREATE TABLE notification_delivery_settings (
    user_id     uuid        NOT NULL,
    channel     text        NOT NULL,

    mode        text        NOT NULL DEFAULT 'immediate',

    -- Local, in the account's own zone. Nine in the morning wherever they are.
    digest_hour integer     NOT NULL DEFAULT 9,

    -- Local hours. The opening hour is quiet and the closing hour is not, so
    -- 22 to 7 is quiet from 22:00 until 06:59.
    quiet_from  integer,
    quiet_until integer,

    updated_at  timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, channel),

    CONSTRAINT notification_delivery_settings_channel_check
        CHECK (channel IN ('email', 'push')),

    CONSTRAINT notification_delivery_settings_mode_check
        CHECK (mode IN ('immediate', 'digest')),

    CONSTRAINT notification_delivery_settings_digest_hour_check
        CHECK (digest_hour BETWEEN 0 AND 23),

    -- Both ends or neither. A half-specified window has no reading at all.
    CONSTRAINT notification_delivery_settings_quiet_pair_check
        CHECK ((quiet_from IS NULL) = (quiet_until IS NULL)),

    CONSTRAINT notification_delivery_settings_quiet_range_check
        CHECK (
            quiet_from IS NULL
            OR (quiet_from BETWEEN 0 AND 23 AND quiet_until BETWEEN 0 AND 23)
        ),

    -- Ends that meet are refused rather than interpreted. Zero hours and every
    -- hour are both defensible readings of `22` to `22`, and picking one would
    -- give somebody a setting they did not ask for — in one direction silence
    -- for a day, in the other no quiet hours at all.
    CONSTRAINT notification_delivery_settings_quiet_distinct_check
        CHECK (quiet_from IS NULL OR quiet_from <> quiet_until),

    CONSTRAINT notification_delivery_settings_user_fk
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- Security joins the categories that cannot be switched off.
--
-- The constraint named a fixed vocabulary, so a new category is a new
-- constraint rather than a new row. `architecture/notifications.md:696` names
-- account security as a mandatory example alongside moderation, and the reason
-- is the same in both cases: a preference that could silence it would hand
-- somebody a way to stop being told that their password changed, which is the
-- one message an account takeover most needs them not to see.
ALTER TABLE notifications
    DROP CONSTRAINT notifications_category_check;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check
        CHECK (category IN ('social', 'media', 'moderation', 'security'));

ALTER TABLE notification_preferences
    DROP CONSTRAINT notification_preferences_category_check;

ALTER TABLE notification_preferences
    ADD CONSTRAINT notification_preferences_category_check
        CHECK (category IN ('social', 'media', 'moderation', 'security'));
