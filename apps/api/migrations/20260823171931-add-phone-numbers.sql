-- A phone number as a way to sign in.
--
-- An email address remains what establishes an account (`users.md:843`); this
-- is a second way in, never the only one. That is deliberate: a number can be
-- lost or reassigned, and an account whose only key is a number is an account
-- that can be lost or taken with it.
CREATE TABLE identity_phones (
    -- E.164, which is the one spelling of a number there is. Primary key, so
    -- two Identities cannot claim the same number and the database decides
    -- which of two simultaneous claims wins rather than application code.
    normalized_phone   text        PRIMARY KEY,

    -- As typed, including whatever spacing and punctuation somebody used.
    phone              text        NOT NULL,

    -- Unique: one account holds one number. Replacing it is a deliberate act
    -- rather than an accumulation.
    identity_id        uuid        NOT NULL UNIQUE,

    -- Null until control of the number is proven by a code sent to it. Claiming
    -- does not prove it, exactly as registering does not prove an address.
    verified_at        timestamptz,

    -- When it was last used to sign in, which is what dormancy is measured
    -- from. Null until it has been.
    last_signed_in_at  timestamptz,

    created_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT identity_phones_identity_fk
        FOREIGN KEY (identity_id) REFERENCES identities (identity_id) ON DELETE CASCADE
);

-- A code sent to a number, and the attempts made against it.
--
-- Deliberately not `magic_link_tokens`. That table holds 32 random bytes, which
-- cannot be guessed; this holds six digits somebody types, which is one in a
-- million. A guessable secret needs an attempt counter that burns it after a
-- few wrong tries and a much shorter life, and storing the two together would
-- invite treating them alike.
--
-- The code itself is never stored, only its SHA-256 hash, so a database leak
-- does not hand over working codes.
CREATE TABLE phone_sign_in_codes (
    code_hash        text        PRIMARY KEY,

    -- Consumption requires both this and the hash. A code is short enough that
    -- binding it to the number it was sent to is what stops one code opening
    -- somebody else's account.
    normalized_phone text        NOT NULL,

    purpose          text        NOT NULL,
    expires_at       timestamptz NOT NULL,
    consumed_at      timestamptz,

    -- Wrong guesses. Once this reaches the limit the code is spent, whether or
    -- not the right one arrives afterwards.
    attempts         integer     NOT NULL DEFAULT 0,

    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT phone_sign_in_codes_purpose_is_known CHECK (
        purpose IN ('claim', 'login')
    )
);

-- Codes are looked up by the number they were sent to, to expire whatever came
-- before when a new one is issued.
CREATE INDEX phone_sign_in_codes_phone_idx
    ON phone_sign_in_codes (normalized_phone, created_at DESC);

CREATE INDEX phone_sign_in_codes_expires_at_idx ON phone_sign_in_codes (expires_at);
