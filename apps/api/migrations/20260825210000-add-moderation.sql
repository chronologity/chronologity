-- What Chronologity distributes, and what it does not.
--
-- The distinction the whole feature rests on (`moderation.md:151`): moderation
-- decides what the platform distributes, not what happened. Nothing here
-- alters occurrence, authorship, or a Moment's position in chronology. A
-- removed Moment did not stop occurring.

-- Suspension, and a constraint the column never had.
--
-- `users.status` has been `text NOT NULL DEFAULT 'active'` since the table was
-- created, with the entity typing three values and the database permitting any
-- string. Adding the third value is the occasion to close that.
ALTER TABLE users
    ADD CONSTRAINT users_status_check
    CHECK (status IN ('active', 'deactivated', 'suspended'));

-- The current state of one thing.
--
-- Keyed on the pair, so a subject has exactly one state and reading it is a
-- primary-key lookup. Absent means `allowed`: the overwhelming majority of
-- everything is unmoderated, and a row per Moment would be a table the size of
-- the platform saying nothing.
CREATE TABLE moderation_states (
    subject_type       text        NOT NULL,
    subject_id         uuid        NOT NULL,
    state              text        NOT NULL,
    reason             text        NOT NULL,

    -- Null where automation set it. Nothing does today — automation is triage
    -- only and never reaches this table — and the column is nullable so that
    -- staying true does not depend on remembering.
    decided_by_user_id uuid,
    decided_at         timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (subject_type, subject_id),

    CONSTRAINT moderation_states_type_check
        CHECK (subject_type IN ('moment', 'comment', 'user', 'media')),

    CONSTRAINT moderation_states_state_check
        CHECK (state IN (
            'allowed',
            'warned',
            'restricted_from_amplification',
            'restricted_to_authorized_audience',
            'age_restricted',
            'temporarily_unavailable',
            'removed'
        )),

    CONSTRAINT moderation_states_decider_fk
        FOREIGN KEY (decided_by_user_id) REFERENCES users (user_id) ON DELETE SET NULL
);

-- Every decision ever made, and every one refused.
--
-- Append-only, and moderation's audit log. `moderation.md:835` requires
-- provenance: a current-state table can say what is true now and never who
-- made it true or why.
--
-- Refusals are recorded as well as decisions, following
-- `authorization_audit_events`, where a refused role grant is written on the
-- reasoning that an attempted self-escalation is exactly what a security
-- review wants to find afterwards. Somebody probing whether they can suspend
-- an account is the same kind of evidence.
CREATE TABLE moderation_actions (
    action_id      uuid        PRIMARY KEY,
    subject_type   text        NOT NULL,
    subject_id     uuid        NOT NULL,

    -- What the subject was put into, or would have been. Null for a suspension,
    -- which is an account status rather than a content state.
    state          text,

    -- Who the action was against, where that is a User. Carried separately from
    -- the subject so that moderating somebody's Moment can be found when they
    -- ask what was done to them, without joining through four content tables.
    affected_user_id uuid,

    actor_user_id  uuid,

    -- `human` or `automated`. Automation is triage only and sets no state; the
    -- column exists so the two can never be confused afterwards, which matters
    -- most when somebody asks why this happened to them.
    actor_kind     text        NOT NULL DEFAULT 'human',

    -- Whether it was carried out or refused.
    outcome        text        NOT NULL DEFAULT 'success',

    reason         text        NOT NULL,
    occurred_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT moderation_actions_type_check
        CHECK (subject_type IN ('moment', 'comment', 'user', 'media')),

    CONSTRAINT moderation_actions_kind_check
        CHECK (actor_kind IN ('human', 'automated')),

    CONSTRAINT moderation_actions_outcome_check
        CHECK (outcome IN ('success', 'failure')),

    CONSTRAINT moderation_actions_actor_fk
        FOREIGN KEY (actor_user_id) REFERENCES users (user_id) ON DELETE SET NULL,

    CONSTRAINT moderation_actions_affected_fk
        FOREIGN KEY (affected_user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- What was done to you, newest first.
CREATE INDEX moderation_actions_affected_idx
    ON moderation_actions (affected_user_id, occurred_at DESC, action_id DESC);

CREATE INDEX moderation_actions_subject_idx
    ON moderation_actions (subject_type, subject_id, occurred_at DESC);

-- Somebody saying something breaks the rules.
CREATE TABLE moderation_reports (
    report_id        uuid        PRIMARY KEY,
    subject_type     text        NOT NULL,
    subject_id       uuid        NOT NULL,

    -- Never disclosed to the subject. `moderation.md:541` expects people to
    -- report conduct they believe breaks the rules, and somebody who fears
    -- being identified for it will not.
    reporter_user_id uuid        NOT NULL,

    reason           text        NOT NULL,
    detail           text,
    status           text        NOT NULL DEFAULT 'submitted',

    -- Ordering only, computed from report volume and reason severity.
    -- `moderation.md:614`: volume "may affect review prioritization" and must
    -- never establish that content violates policy. Nothing reads this to
    -- decide an outcome.
    priority         text        NOT NULL DEFAULT 'normal',

    created_at       timestamptz NOT NULL DEFAULT now(),
    resolved_at      timestamptz,

    -- One person reports one thing once.
    --
    -- The crudest form of manufactured volume, removed by the database rather
    -- than by a rule somebody has to remember. It does not stop a coordinated
    -- group, and nothing here pretends to: what it stops is one account
    -- inflating a count by itself.
    CONSTRAINT moderation_reports_once
        UNIQUE (subject_type, subject_id, reporter_user_id),

    CONSTRAINT moderation_reports_type_check
        CHECK (subject_type IN ('moment', 'comment', 'user', 'media')),

    CONSTRAINT moderation_reports_status_check
        CHECK (status IN ('submitted', 'under_review', 'resolved', 'closed')),

    CONSTRAINT moderation_reports_priority_check
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

    CONSTRAINT moderation_reports_reporter_fk
        FOREIGN KEY (reporter_user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- The queue: what is still open, most urgent first.
CREATE INDEX moderation_reports_queue_idx
    ON moderation_reports (status, priority, created_at, report_id);

-- Your own reports, newest first.
CREATE INDEX moderation_reports_reporter_idx
    ON moderation_reports (reporter_user_id, created_at DESC, report_id DESC);

-- Every report about one subject, for counting and for burst detection.
CREATE INDEX moderation_reports_subject_idx
    ON moderation_reports (subject_type, subject_id, created_at);

-- Somebody saying a Moment is wrong about history.
--
-- Its own table rather than a reason code in the one above.
-- `moderation.md:600`: conflating the two "would encourage safety moderators to
-- become arbiters of historical metadata and historical reviewers to handle
-- urgent abuse". Separating later would mean migrating whatever had been filed
-- under the wrong one.
--
-- No moderation state is reachable from here. `moderation.md:527` holds a
-- historical correction apart from a moderation action: a wrong date is
-- something to fix, not something to enforce against.
CREATE TABLE accuracy_reports (
    report_id        uuid        PRIMARY KEY,
    moment_id        uuid        NOT NULL,
    reporter_user_id uuid        NOT NULL,
    reason           text        NOT NULL,

    -- Required, unlike a safety report's detail: "this is wrong" without
    -- saying what is right gives a reviewer nothing to check.
    detail           text        NOT NULL,

    status           text        NOT NULL DEFAULT 'submitted',
    created_at       timestamptz NOT NULL DEFAULT now(),
    resolved_at      timestamptz,

    CONSTRAINT accuracy_reports_once
        UNIQUE (moment_id, reporter_user_id),

    CONSTRAINT accuracy_reports_reason_check
        CHECK (reason IN ('wrong_date', 'wrong_place', 'wrong_event', 'other')),

    CONSTRAINT accuracy_reports_status_check
        CHECK (status IN ('submitted', 'under_review', 'resolved', 'closed')),

    CONSTRAINT accuracy_reports_moment_fk
        FOREIGN KEY (moment_id) REFERENCES moments (moment_id) ON DELETE CASCADE,

    CONSTRAINT accuracy_reports_reporter_fk
        FOREIGN KEY (reporter_user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE INDEX accuracy_reports_queue_idx
    ON accuracy_reports (status, created_at, report_id);

CREATE INDEX accuracy_reports_reporter_idx
    ON accuracy_reports (reporter_user_id, created_at DESC, report_id DESC);

-- Contesting a decision.
--
-- An enforcement system with no way to be wrong is a bad one.
CREATE TABLE moderation_appeals (
    appeal_id          uuid        PRIMARY KEY,
    action_id          uuid        NOT NULL,
    appellant_user_id  uuid        NOT NULL,
    statement          text        NOT NULL,
    status             text        NOT NULL DEFAULT 'open',
    outcome            text,
    resolution         text,
    decided_by_user_id uuid,
    created_at         timestamptz NOT NULL DEFAULT now(),
    decided_at         timestamptz,

    CONSTRAINT moderation_appeals_status_check
        CHECK (status IN ('open', 'decided')),

    CONSTRAINT moderation_appeals_outcome_check
        CHECK (outcome IS NULL OR outcome IN ('upheld', 'reversed')),

    -- A decided appeal has an outcome and an open one does not. Without this the
    -- two columns can disagree, and "decided with no outcome" is a state no
    -- reader knows how to render.
    CONSTRAINT moderation_appeals_decided_check
        CHECK ((status = 'decided') = (outcome IS NOT NULL)),

    CONSTRAINT moderation_appeals_action_fk
        FOREIGN KEY (action_id) REFERENCES moderation_actions (action_id) ON DELETE CASCADE,

    CONSTRAINT moderation_appeals_appellant_fk
        FOREIGN KEY (appellant_user_id) REFERENCES users (user_id) ON DELETE CASCADE,

    CONSTRAINT moderation_appeals_decider_fk
        FOREIGN KEY (decided_by_user_id) REFERENCES users (user_id) ON DELETE SET NULL
);

-- One open appeal per action.
--
-- Partial, so a decided appeal does not block a later one if policy ever allows
-- reopening. Without it the same decision can be contested indefinitely, and
-- the appeal queue becomes the pressure surface the report queue was protected
-- from.
CREATE UNIQUE INDEX moderation_appeals_one_open
    ON moderation_appeals (action_id)
    WHERE status = 'open';

CREATE INDEX moderation_appeals_queue_idx
    ON moderation_appeals (status, created_at, appeal_id);

CREATE INDEX moderation_appeals_appellant_idx
    ON moderation_appeals (appellant_user_id, created_at DESC, appeal_id DESC);
