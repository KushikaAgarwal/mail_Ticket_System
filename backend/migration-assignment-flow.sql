-- ============================================================
-- Zone round-robin -> Manager -> Lead -> Customer Support flow
-- Safe to re-run (everything uses IF NOT EXISTS / OR REPLACE).
-- Run from the project root:
--   docker compose cp backend\migration-assignment-flow.sql flowable-db:/tmp/m.sql
--   docker compose exec flowable-db psql -U flowable -d helpdesk -f /tmp/m.sql
-- ============================================================

-- 1) Ticket columns -------------------------------------------------
-- Existing columns used as-is: zone_id, owner_lead_id, assigned_by_id,
-- assigned_by_role. New ones below.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS support_id UUID REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS due_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_manager ON tickets (manager_id, ticket_status);
CREATE INDEX IF NOT EXISTS idx_tickets_lead    ON tickets (owner_lead_id, ticket_status);
CREATE INDEX IF NOT EXISTS idx_tickets_support ON tickets (support_id, ticket_status);

-- 2) Round-robin pointer, one row per zone --------------------------
CREATE TABLE IF NOT EXISTS zone_rr_state (
    zone_id          INTEGER PRIMARY KEY REFERENCES zones(id),
    last_manager_id  UUID REFERENCES users(id),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO zone_rr_state (zone_id)
SELECT id FROM zones
ON CONFLICT (zone_id) DO NOTHING;

-- 3) Assignment history (who handed the ticket to whom, and when) ----
CREATE TABLE IF NOT EXISTS ticket_assignment_history (
    id             BIGSERIAL PRIMARY KEY,
    ticket_id      UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    action         VARCHAR(30) NOT NULL,   -- AUTO_MANAGER | TO_LEAD | TO_SUPPORT | DEADLINE_SET | DEADLINE_APPROVED
    from_user_id   UUID REFERENCES users(id),
    to_user_id     UUID REFERENCES users(id),
    to_role        VARCHAR(20),
    due_at         TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assign_hist_ticket
    ON ticket_assignment_history (ticket_id, created_at);

-- 4) Deadline change requests (lead / support ask, manager decides) --
CREATE TABLE IF NOT EXISTS deadline_change_requests (
    id               BIGSERIAL PRIMARY KEY,
    ticket_id        UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    requested_by     UUID NOT NULL REFERENCES users(id),
    requested_role   VARCHAR(20) NOT NULL,
    proposed_due_at  TIMESTAMPTZ NOT NULL,
    reason           TEXT,
    status           VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','APPROVED','REJECTED')),
    decided_by       UUID REFERENCES users(id),
    decided_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one open request per ticket at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_deadline_req_one_pending
    ON deadline_change_requests (ticket_id) WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_deadline_req_ticket
    ON deadline_change_requests (ticket_id, created_at DESC);

-- 5) Round-robin function --------------------------------------------
-- Call right after a ticket row (with zone_id set) is inserted:
--     SELECT assign_next_manager('<ticket uuid>');
-- Locks the zone's pointer row, so two tickets arriving at the same moment
-- can never get the same manager. Picks the next active MANAGER of that zone
-- (ordered by created_at, id) after the last one used, wrapping around.
-- Adding or deactivating managers is handled automatically.
-- Returns the manager's id, or NULL if the ticket has no zone or the zone has
-- no active managers (ticket then stays unassigned).
CREATE OR REPLACE FUNCTION assign_next_manager(p_ticket_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_zone INTEGER;
    v_last UUID;
    v_next UUID;
BEGIN
    SELECT zone_id INTO v_zone FROM tickets WHERE id = p_ticket_id;
    IF v_zone IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO zone_rr_state (zone_id) VALUES (v_zone)
    ON CONFLICT (zone_id) DO NOTHING;

    SELECT last_manager_id INTO v_last
    FROM zone_rr_state WHERE zone_id = v_zone
    FOR UPDATE;

    -- next manager after the last one used
    SELECT m.id INTO v_next
    FROM users m
    WHERE m.role = 'MANAGER' AND m.active AND m.zone_id = v_zone
      AND v_last IS NOT NULL
      AND (m.created_at, m.id) > (SELECT u.created_at, u.id FROM users u WHERE u.id = v_last)
    ORDER BY m.created_at, m.id
    LIMIT 1;

    -- wrap around (or first ticket ever for this zone)
    IF v_next IS NULL THEN
        SELECT m.id INTO v_next
        FROM users m
        WHERE m.role = 'MANAGER' AND m.active AND m.zone_id = v_zone
        ORDER BY m.created_at, m.id
        LIMIT 1;
    END IF;

    IF v_next IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE zone_rr_state
       SET last_manager_id = v_next, updated_at = now()
     WHERE zone_id = v_zone;

    UPDATE tickets
       SET manager_id = v_next,
           assigned_by_role = 'SYSTEM'
     WHERE id = p_ticket_id;

    INSERT INTO ticket_assignment_history (ticket_id, action, to_user_id, to_role)
    VALUES (p_ticket_id, 'AUTO_MANAGER', v_next, 'MANAGER');

    RETURN v_next;
END;
$$;