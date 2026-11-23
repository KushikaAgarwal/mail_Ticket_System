/**
 * All user/zone/role-hierarchy access lives here — same pattern as
 * ticketsRepo.js. Nothing in this file talks to Flowable; Flowable no
 * longer owns identity at all (see role_hierarchy_schema.sql notes).
 */
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { query } = require('./db');

const SALT_ROUNDS = 12;

// Who's allowed to create whom. Enforced here (not just in the frontend)
// so the hierarchy can't be bypassed by calling the API directly.
const ALLOWED_CREATION = {
  SUPER_ADMIN: 'SUPERVISOR',
  SUPERVISOR: 'ZONAL_ADMIN',
  ZONAL_ADMIN: 'ZONAL_EXECUTIVE',
  ZONAL_EXECUTIVE: 'CUSTOMER_SUPPORT',
};

// Roles that are scoped to a single zone (must have zone_id set).
const ZONE_SCOPED_ROLES = new Set(['ZONAL_ADMIN', 'ZONAL_EXECUTIVE', 'CUSTOMER_SUPPORT']);

function userRowToObject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    zoneId: row.zone_id,
    zoneName: row.zone_name || undefined,
    createdBy: row.created_by,
    active: row.active,
    createdAt: row.created_at,
  };
}

async function listZones() {
  const { rows } = await query(`SELECT id, name FROM zones ORDER BY id ASC`);
  return rows;
}

async function getUserByEmail(email) {
  const { rows } = await query(
    `SELECT u.*, z.name AS zone_name FROM users u LEFT JOIN zones z ON z.id = u.zone_id WHERE u.email = $1`,
    [email]
  );
  return userRowToObject(rows[0]);
}

async function getUserById(id) {
  const { rows } = await query(
    `SELECT u.*, z.name AS zone_name FROM users u LEFT JOIN zones z ON z.id = u.zone_id WHERE u.id = $1`,
    [id]
  );
  return userRowToObject(rows[0]);
}

/** Returns the full user row (including password_hash) — only for the
 *  login path, never exposed via userRowToObject to API responses. */
async function getRawUserByEmail(email) {
  const { rows } = await query(`SELECT * FROM users WHERE email = $1 AND active = TRUE`, [email]);
  return rows[0] || null;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}


/** Generates a one-time reset token, stores only its hash + a 1-hour
 *  expiry against the user, and returns the RAW token — the raw value
 *  is only ever put in the emailed link, never persisted. */
async function createPasswordResetToken(email) {
  const user = await getUserByEmail(email);
  if (!user) return null; // caller decides whether to reveal this
 
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
 
  await query(
    `UPDATE users SET reset_token_hash = $1, reset_token_expires_at = $2 WHERE id = $3`,
    [tokenHash, expiresAt, user.id]
  );
 
  return { user, rawToken };
}
 
/** Verifies a raw token from the reset link and, if valid and unexpired,
 *  sets the new password and invalidates the token (single-use). */
async function resetPasswordWithToken(rawToken, newPassword) {
  const tokenHash = hashToken(rawToken);
  const { rows } = await query(
    `SELECT id, reset_token_expires_at FROM users WHERE reset_token_hash = $1`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return { error: 'This reset link is invalid.' };
  if (!row.reset_token_expires_at || new Date(row.reset_token_expires_at) < new Date()) {
    return { error: 'This reset link has expired. Please request a new one.' };
  }
 
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await query(
    `UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = $2`,
    [passwordHash, row.id]
  );
  return { success: true };
}

async function verifyLogin(email, password) {
  const row = await getRawUserByEmail(email);
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;
  return getUserById(row.id);
}

/** Creates a subordinate account. `creator` is the authenticated user
 *  making the request (from the JWT, never trust a client-supplied
 *  role/creatorId). Throws a plain Error with a user-facing message on
 *  any hierarchy violation — callers should map that to a 403. */
async function createSubordinate(creator, { name, email, password, role, zoneId }) {
  const expectedRole = ALLOWED_CREATION[creator.role];
  if (!expectedRole) {
    throw new Error(`${creator.role} accounts cannot create other accounts.`);
  }
  if (role !== expectedRole) {
    throw new Error(`${creator.role} can only create ${expectedRole} accounts.`);
  }

  let resolvedZoneId = null;
  if (ZONE_SCOPED_ROLES.has(role)) {
    if (role === 'ZONAL_ADMIN') {
      // Supervisor picks which zone this admin runs.
      if (!zoneId) throw new Error('zoneId is required when creating a ZONAL_ADMIN.');
      resolvedZoneId = zoneId;
    } else {
      // ZONAL_EXECUTIVE and CUSTOMER_SUPPORT inherit the creator's own
      // zone — a zonal admin can't accidentally place an executive in a
      // different zone than themselves.
      if (!creator.zoneId) throw new Error('Creating account has no zone assigned.');
      resolvedZoneId = creator.zoneId;
    }
  }

  const existing = await getUserByEmail(email);
  if (existing) throw new Error('A user with this email already exists.');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, role, zone_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, email, passwordHash, role, resolvedZoneId, creator.id]
  );
  return getUserById(rows[0].id);
}

/** Lists users, scoped by the requester's role — used for the "Team"
 *  page and for populating assignment dropdowns. */
async function listUsers(requester, { role } = {}) {
  const clauses = [];
  const params = [];

  if (role) {
    params.push(role);
    clauses.push(`u.role = $${params.length}`);
  }

  // SUPER_ADMIN / SUPERVISOR / ZONAL_ADMIN see everyone (per your "sees
  // all activities" note for zonal admin — extended here to team listing
  // too, since they need visibility to manage things).
  if (requester.role === 'ZONAL_EXECUTIVE') {
    // Executives only manage their own zone's customer support roster.
    params.push(requester.zoneId);
    clauses.push(`u.zone_id = $${params.length}`);
  } else if (requester.role === 'CUSTOMER_SUPPORT') {
    // Support agents don't manage anyone.
    return [];
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT u.*, z.name AS zone_name FROM users u LEFT JOIN zones z ON z.id = u.zone_id ${where} ORDER BY u.created_at DESC`,
    params
  );
  return rows.map(userRowToObject);
}

/** Customer Support agents in a given zone — used to populate the Zonal
 *  Executive's assignment dropdown. */
async function listCustomerSupportInZone(zoneId) {
  const { rows } = await query(
    `SELECT u.*, z.name AS zone_name FROM users u LEFT JOIN zones z ON z.id = u.zone_id
      WHERE u.role = 'CUSTOMER_SUPPORT' AND u.zone_id = $1 AND u.active = TRUE
      ORDER BY u.name ASC`,
    [zoneId]
  );
  return rows.map(userRowToObject);
}

/** Every active Zonal Admin + Zonal Executive, for the new-ticket
 *  notification fan-out. */
async function listZonalStaffEmails() {
  const { rows } = await query(
    `SELECT email, name FROM users WHERE role IN ('ZONAL_ADMIN','ZONAL_EXECUTIVE') AND active = TRUE`
  );
  return rows;
}

async function listAllCustomerSupport() {
  const { rows } = await query(
    `SELECT u.*, z.name AS zone_name FROM users u LEFT JOIN zones z ON z.id = u.zone_id
      WHERE u.role = 'CUSTOMER_SUPPORT' AND u.active = TRUE
      ORDER BY z.name ASC, u.name ASC`
  );
  return rows.map(userRowToObject);
}

module.exports = {
  listZones,
  getUserByEmail,
  getUserById,
  verifyLogin,
  createSubordinate,
  createPasswordResetToken,
  resetPasswordWithToken,
  listUsers,
  listCustomerSupportInZone,
  listZonalStaffEmails,
  listAllCustomerSupport,
  ALLOWED_CREATION,
};