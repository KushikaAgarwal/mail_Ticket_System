// assignmentService.js
// Zone -> Manager (round robin) -> Lead (+ deadline set by the Manager) -> Customer Support.
//
// ASSUMED SCHEMA (change the SQL below if yours differs):
//   users   (id, name, role, zone_id, created_by, is_active, last_ticket_assigned_at)
//   tickets (process_instance_id, zone_id, manager_id, manager_assigned_at,
//            assigned_lead_id, lead_assigned_at, due_at)
//   `pool` is exported from ./db

const { pool } = require('./db');

const RR_LOCK_NAMESPACE = 1001; // any constant; keeps our advisory locks apart from others

/**
 * Give a ticket to the next Manager of its zone, in rotation.
 * "Next" = the active Manager who was assigned a ticket longest ago
 * (never-assigned Managers go first). With 3 managers this gives
 * m1, m2, m3, m1, m2, m3 ... and it keeps working when Managers are
 * added, removed or deactivated.
 *
 * Safe under load: one lock per zone, so two tickets arriving at the same
 * instant can't pick the same Manager, and no Manager is skipped.
 *
 * @returns {Promise<string|null>} the Manager's id, or null if nothing was assigned
 */
async function autoAssignToManager(ticketId, zoneId) {
  if (zoneId == null) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [RR_LOCK_NAMESPACE, Number(zoneId)]);

    const { rows } = await client.query(
      `SELECT id FROM users
        WHERE role = 'MANAGER' AND zone_id = $1 AND is_active = TRUE
        ORDER BY last_ticket_assigned_at ASC NULLS FIRST, id ASC
        LIMIT 1`,
      [zoneId]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn(`[assign] zone ${zoneId} has no active Manager; ticket ${ticketId} left unassigned`);
      return null;
    }
    const managerId = String(rows[0].id);

    // manager_id IS NULL: never overwrite an existing assignment (e.g. a retry).
    const upd = await client.query(
      `UPDATE tickets
          SET manager_id = $1, manager_assigned_at = now()
        WHERE process_instance_id = $2 AND manager_id IS NULL`,
      [managerId, ticketId]
    );
    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('UPDATE users SET last_ticket_assigned_at = now() WHERE id::text = $1', [managerId]);
    await client.query('COMMIT');
    return managerId;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[assign] auto-assign to manager failed:', err.message);
    return null; // never fail ticket creation because of this
  } finally {
    client.release();
  }
}

/** Leads this user may hand a ticket to. */
async function listLeadsFor(user, zoneIdFromQuery) {
  let sql = `SELECT id, name, zone_id AS "zoneId" FROM users WHERE role = 'LEAD' AND is_active = TRUE`;
  const params = [];
  if (user.role === 'MANAGER') {
    params.push(String(user.id));
    sql += ` AND created_by::text = $1`; // the Manager's own leads
  } else if (user.role === 'ZONAL_ADMIN') {
    if (user.zoneId == null) return [];
    params.push(user.zoneId);
    sql += ` AND zone_id = $1`;
  } else if (zoneIdFromQuery) {
    params.push(Number(zoneIdFromQuery));
    sql += ` AND zone_id = $1`;
  }
  sql += ' ORDER BY name';
  const { rows } = await pool.query(sql, params);
  return rows.map((r) => ({ id: String(r.id), name: r.name, zoneId: r.zoneId }));
}

/** Manager (or above) hands the ticket to a Lead and sets the deadline. */
async function assignToLead(ticketId, { leadId, dueAt }) {
  const { rowCount } = await pool.query(
    `UPDATE tickets
        SET assigned_lead_id = $1, lead_assigned_at = now(), due_at = $2
      WHERE process_instance_id = $3`,
    [String(leadId), dueAt, ticketId]
  );
  return rowCount > 0;
}

/** Names + deadline for the ticket page. */
async function getAssignmentSummary(ticketId) {
  const { rows } = await pool.query(
    `SELECT t.manager_id, m.name AS manager_name,
            t.assigned_lead_id, l.name AS lead_name,
            t.due_at
       FROM tickets t
       LEFT JOIN users m ON m.id::text = t.manager_id
       LEFT JOIN users l ON l.id::text = t.assigned_lead_id
      WHERE t.process_instance_id = $1`,
    [ticketId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    managerId: r.manager_id,
    managerName: r.manager_name,
    assignedLeadId: r.assigned_lead_id,
    assignedLeadName: r.lead_name,
    dueAt: r.due_at,
    overdue: r.due_at ? new Date(r.due_at) < new Date() : false,
  };
}

module.exports = { autoAssignToManager, listLeadsFor, assignToLead, getAssignmentSummary };