-- ============================================================
-- PS QuickIt — additional application tables (run AFTER
-- tickets_schema.sql, same flowable-db Postgres container).
--
-- These four tables cover the things the first migration didn't:
--   1. ticket_status_history — every status change, timestamped
--      (today this only lives inside Flowable's historic-detail
--      table, which is slow to query and disappears if you ever
--      move away from Flowable). Now it's a simple indexed table.
--   2. ticket_attachments — metadata for files attached to an
--      inbound email (the file itself stays on disk/S3, this row
--      just points at it).
--   3. notification_log — one row every time an acknowledgement or
--      comment email is sent, so you can see delivery history and
--      stop guessing whether a mail actually went out.
--   4. engineers_cache — a local copy of the 'engineer' group from
--      Flowable identity, refreshed periodically, so the assignment
--      dropdown loads instantly instead of calling Flowable on
--      every page open.
-- ============================================================

-- 1) Status history — append-only log, one row per change.
CREATE TABLE IF NOT EXISTS ticket_status_history (
    id            BIGSERIAL PRIMARY KEY,
    ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    status        VARCHAR(20) NOT NULL,
    changed_by    VARCHAR(255),           -- engineer id/name, or 'system'
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_history_ticket
    ON ticket_status_history (ticket_id, changed_at);


-- 2) Attachments — metadata only. Store the actual bytes on disk or
--    S3/MinIO and keep storage_path as the pointer to it.
CREATE TABLE IF NOT EXISTS ticket_attachments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id      UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    filename       VARCHAR(500) NOT NULL,
    content_type   VARCHAR(255),
    size_bytes     INTEGER,
    storage_path   TEXT NOT NULL,          -- e.g. /data/attachments/<uuid>_<filename>
    source_message_id VARCHAR(255),        -- which email this came from
    uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_ticket
    ON ticket_attachments (ticket_id);


-- 3) Notification log — every outbound email attempt, success or fail.
CREATE TABLE IF NOT EXISTS notification_log (
    id              BIGSERIAL PRIMARY KEY,
    ticket_id       UUID REFERENCES tickets(id) ON DELETE CASCADE,
    type            VARCHAR(30) NOT NULL,   -- 'ACKNOWLEDGEMENT' | 'COMMENT' | ...
    to_email        VARCHAR(255),
    message_id      VARCHAR(255),           -- the sent email's Message-Id, if any
    success         BOOLEAN NOT NULL DEFAULT TRUE,
    error_message   TEXT,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_ticket
    ON notification_log (ticket_id, sent_at DESC);


-- 4) Engineers cache — local mirror of Flowable's 'engineer' group,
--    refreshed on a timer (e.g. every 5 min) instead of hit on every
--    dropdown open. last_synced_at tells you how stale it is.
CREATE TABLE IF NOT EXISTS engineers_cache (
    id              VARCHAR(64) PRIMARY KEY,   -- Flowable user id
    name            VARCHAR(255),
    email           VARCHAR(255),
    last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
