-- add-users
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- The User: who someone is in the product, as distinct from the Identity that
-- proves who they are.

-- Handle assignments, current and past.
--
-- The primary key is the normalised handle, so the database decides who wins
-- when two people claim the same one at the same moment. Deciding that in
-- application code would let both win.
--
-- Released rows are kept rather than deleted. Releasing a handle for immediate
-- reassignment invites impersonation and breaks references, so a handle stays
-- claimed by its original owner for a cooldown after it is given up.
CREATE TABLE user_handles (
    normalized_handle text        PRIMARY KEY,
    handle            text        NOT NULL,
    user_id           uuid        NOT NULL,
    assigned_at       timestamptz NOT NULL DEFAULT now(),
    released_at       timestamptz
);

-- One current handle per User; past ones have released_at set.
CREATE UNIQUE INDEX user_handles_current_idx
    ON user_handles (user_id)
    WHERE released_at IS NULL;

CREATE INDEX user_handles_released_idx
    ON user_handles (released_at)
    WHERE released_at IS NOT NULL;

-- The User read model.
--
-- Derived from User history and used for lookups and profile reads. The
-- aggregate remains the authority for decisions; this is what the product
-- reads.
CREATE TABLE users (
    user_id      uuid        PRIMARY KEY,
    identity_id  uuid        NOT NULL UNIQUE,
    handle       text        NOT NULL,
    display_name text        NOT NULL,
    biography    text,
    status       text        NOT NULL DEFAULT 'active',
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Resolving the signed-in Identity to its User happens on every sign-in.
CREATE INDEX users_identity_idx ON users (identity_id);

-- Preferences.
--
-- Columns rather than a blob, so each can be constrained and queried, and so
-- adding one is a migration someone has to think about. Only the preferences
-- day-one features actually read are here; notification and privacy
-- preferences arrive with the features that read them.
CREATE TABLE user_preferences (
    user_id          uuid        PRIMARY KEY,
    -- The product's intended default is autoplay with sound; people can turn
    -- it off. Defaulting it off here would quietly change the product.
    autoplay_videos  boolean     NOT NULL DEFAULT true,
    autoplay_sound   boolean     NOT NULL DEFAULT true,
    -- BCP 47, and IANA respectively. Absent means "follow the device", which
    -- is different from any particular value.
    locale           text,
    time_zone        text,
    reduced_motion   boolean     NOT NULL DEFAULT false,
    updated_at       timestamptz NOT NULL DEFAULT now()
);
