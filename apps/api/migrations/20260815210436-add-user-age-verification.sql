-- add-user-age-verification
--
-- Applied in filename order, once, inside a transaction. Editing this file
-- after it has been applied anywhere changes nothing: write a new migration.
--
-- Date of birth, held to enforce a minimum account age.

-- Restricted personal data, kept apart from the profile.
--
-- A separate table rather than a column on `users` so that no query written
-- against the profile can return it by accident. `SELECT *` on users is a
-- mistake waiting to happen; here it is not even possible.
--
-- Never enters event history: history is permanent, and a birthdate written
-- there could not be erased when someone asks for their data to be deleted.
CREATE TABLE user_restricted_data (
    user_id       uuid        PRIMARY KEY,
    -- A calendar date, not an instant. Someone born on a date was born on that
    -- date everywhere, whatever the reader's time zone.
    date_of_birth date        NOT NULL,
    -- What the minimum was when this account was created. Kept because the
    -- threshold is configuration and may change: without it, nobody can say
    -- afterwards which rule an account was admitted under.
    minimum_age_at_creation integer NOT NULL,
    recorded_at   timestamptz NOT NULL DEFAULT now()
);
