CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS zones (
    id      SERIAL PRIMARY KEY,
    name    VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO zones (name) VALUES ('North'), ('South'), ('East'), ('West')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            VARCHAR(20) NOT NULL CHECK (
                        role IN ('SUPER_ADMIN','SUPERVISOR','ZONAL_ADMIN','ZONAL_EXECUTIVE','CUSTOMER_SUPPORT')
                    ),
    zone_id         INTEGER REFERENCES zones(id),
    created_by      UUID REFERENCES users(id),
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role_zone ON users (role, zone_id);
CREATE INDEX IF NOT EXISTS idx_users_created_by ON users (created_by);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_by_id UUID REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_by_role VARCHAR(20);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_locked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_tickets_zone ON tickets (zone_id, ticket_status);