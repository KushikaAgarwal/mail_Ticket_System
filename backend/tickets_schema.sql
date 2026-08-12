-- ============================================================
-- PS QuickIt — application tables (separate from Flowable's own
-- ACT_* tables, but living in the SAME Postgres database/container).
-- Flowable keeps handling workflow state (which step, who's assigned
-- as the ACTIVE task, moving forward). These tables hold everything
-- else: the searchable ticket content, comments, and reply threads.
-- ============================================================

-- Ticket numbers: replaces ticketCounter.json.
-- Postgres hands out the next number safely even if many requests
-- (or many backend servers) ask at the exact same time.
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START 1;

-- One row per ticket.
CREATE TABLE IF NOT EXISTS tickets (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number           INTEGER NOT NULL UNIQUE DEFAULT nextval('ticket_number_seq'),

    -- Link back to Flowable — this is the only thing Flowable and this
    -- table have in common. Flowable still owns "what step is this on".
    process_instance_id    VARCHAR(64) NOT NULL UNIQUE,

    -- 'email' or 'call' — matches mailIngest.js / callIngest.js
    source                  VARCHAR(16) NOT NULL DEFAULT 'email',

    -- Gmail Message-Id (email tickets) or callId (call tickets).
    -- Used today for de-dupe so re-polling never creates a second ticket.
    business_key            VARCHAR(255) NOT NULL UNIQUE,

    subject                 TEXT,
    description              TEXT,
    customer_name            VARCHAR(255),
    customer_email           VARCHAR(255),
    product_or_category      VARCHAR(100),
    urgency                  VARCHAR(20),
    sentiment                VARCHAR(20),

    ticket_status            VARCHAR(20) NOT NULL DEFAULT 'OPEN',   -- OPEN / IN_PROGRESS / RESOLVED / CLOSED

    assigned_engineer_id     VARCHAR(64),
    assigned_engineer_name   VARCHAR(255),

    received_at              TIMESTAMPTZ,
    last_activity_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Call-ticket-only fields (NULL for email tickets)
    call_id                   VARCHAR(64),
    caller_number             VARCHAR(32),
    agent_id                  VARCHAR(64),
    call_answered_at          TIMESTAMPTZ,
    call_ended_at             TIMESTAMPTZ,
    call_duration_seconds     INTEGER
);

-- The indexes are what make lookups instant instead of "loop through
-- everything in Flowable" like getInstanceIdByTicketNumber does today.
CREATE INDEX IF NOT EXISTS idx_tickets_status_activity
    ON tickets (ticket_status, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_assignee
    ON tickets (assigned_engineer_id, ticket_status);

CREATE INDEX IF NOT EXISTS idx_tickets_customer_email
    ON tickets (customer_email);

-- ticket_number and business_key already get an index automatically
-- from their UNIQUE constraints above — no extra index needed for those.


-- One row per comment, instead of one big JSON blob rewritten every time.
CREATE TABLE IF NOT EXISTS ticket_comments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id     VARCHAR(64),
    author_name   VARCHAR(255),
    role          VARCHAR(20) DEFAULT 'admin',   -- 'admin' or 'customer'
    text          TEXT NOT NULL,
    visible       BOOLEAN NOT NULL DEFAULT TRUE, -- customer-visibility toggle
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_ticket
    ON ticket_comments (ticket_id, created_at);


-- One row per email Message-Id in a ticket's reply thread, instead of a
-- JSON array replaced wholesale every time (threadMessageIds today).
CREATE TABLE IF NOT EXISTS ticket_thread_messages (
    id            BIGSERIAL PRIMARY KEY,
    ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    message_id    VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ticket_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_message_id
    ON ticket_thread_messages (message_id);

-- Needed once for gen_random_uuid() above (built into Postgres 13+,
-- but this makes sure the extension is enabled either way):
CREATE EXTENSION IF NOT EXISTS pgcrypto;
