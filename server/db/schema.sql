-- SeatSync database schema — transcribed exactly from docs/implementation_plan.md §10.1 (ER diagram) and §10.3 (indexes).
-- Idempotent: safe to run repeatedly.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    activity_type text NOT NULL,
    city text,
    date_from date,
    date_to date,
    share_token text NOT NULL,
    organizer_token text NOT NULL,
    status text NOT NULL DEFAULT 'collecting',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    display_name text NOT NULL,
    participant_token text NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    budget_ceiling int,
    seat_class text,
    seats_together boolean,
    preferred_location text,
    notes text,
    availability_source text NOT NULL DEFAULT 'manual',
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS availability_windows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    preference_id uuid NOT NULL REFERENCES preferences(id) ON DELETE CASCADE,
    start_ts timestamptz NOT NULL,
    end_ts timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS consensus (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    constraint_set jsonb,
    conflicts jsonb,
    intersection jsonb,
    llm_provider_used text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- §10.1's CONSENSUS entity omits two fields §12.2/§13.7/§16.4 require the
-- aggregation call to always produce: the organizer-facing prose summary,
-- and the `llm_unavailable` flag the UI needs to show a plain-language
-- notice instead of AI prose when both providers fail (§16.4 "the product
-- books either way"). Added here, additively and idempotently, rather than
-- silently dropping them in the P2-T8 persistence wiring.
ALTER TABLE consensus ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE consensus ADD COLUMN IF NOT EXISTS llm_unavailable boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS options (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    external_id text,
    title text,
    venue text,
    show_time timestamptz,
    price int,
    raw jsonb,
    score numeric,
    reasoning text,
    rank int
);

CREATE TABLE IF NOT EXISTS automation_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    option_id uuid REFERENCES options(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'queued',
    current_step text,
    human_action_needed text,
    result jsonb,
    error_code text,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES automation_jobs(id) ON DELETE CASCADE,
    step text,
    level text,
    message text,
    screenshot_path text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    job_id uuid REFERENCES automation_jobs(id) ON DELETE CASCADE,
    booking_details jsonb,
    total_amount int,
    payment_state text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_shares (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    amount int,
    status text NOT NULL DEFAULT 'pending',
    checkout_url text,
    external_payment_id text
);

-- Indexes — §10.3

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_share_token   ON sessions(share_token);
CREATE INDEX        IF NOT EXISTS idx_participants_session   ON participants(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_token     ON participants(participant_token);
CREATE INDEX        IF NOT EXISTS idx_prefs_participant      ON preferences(participant_id);
CREATE INDEX        IF NOT EXISTS idx_windows_preference     ON availability_windows(preference_id);
CREATE INDEX        IF NOT EXISTS idx_options_session_rank   ON options(session_id, rank);
CREATE INDEX        IF NOT EXISTS idx_jobs_status_created    ON automation_jobs(status, created_at);
CREATE INDEX        IF NOT EXISTS idx_job_events_job         ON job_events(job_id, created_at);
