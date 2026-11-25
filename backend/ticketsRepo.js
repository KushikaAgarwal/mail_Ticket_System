/**
 * All Postgres access for the app's own data lives here — nothing in this
 * file talks to Flowable. flowableClient.js keeps owning workflow (which
 * step a ticket is on, task claim/complete); this file owns everything
 * else (ticket content, comments, thread, status history, attachments,
 * notification log, zone/role-based scoping and the assignment lock).
 *
 * Every function returns plain JS objects (already camelCase where it
 * matters) so callers in server.js/mailIngest.js/callIngest.js never see
 * raw SQL rows.
 */
const { query, withTransaction } = require('./db');

// ── helpers ──────────────────────────────────────────────────────────

function ticketRowToObject(row) {
  if (!row) return null;
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    processInstanceId: row.process_instance_id,
    source: row.source,
    businessKey: row.business_key,
    subject: row.subject,
    description: row.description,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    productOrCategory: row.product_or_category,
    urgency: row.urgency,
    sentiment: row.sentiment,
    ticketStatus: row.ticket_status,
    assignedEngineerId: row.assigned_engineer_id,
    assignedEngineerName: row.assigned_engineer_name,
    assignedByRole: row.assigned_by_role,
    assignedById: row.assigned_by_id,
    zoneId: row.zone_id,
    zoneName: row.zone_name || null,
    assignmentLocked: row.assignment_locked,
    receivedAt: row.received_at,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    callId: row.call_id,
    callerNumber: row.caller_number,
    agentId: row.agent_id,
    callAnsweredAt: row.call_answered_at,
    callEndedAt: row.call_ended_at,
    callDurationSeconds: row.call_duration_seconds,
  };
}

function commentRowToObject(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    authorId: row.author_id,
    authorName: row.author_name,
    role: row.role,
    text: row.text,
    visible: row.visible,
    timestamp: row.created_at,
  };
}

// ── ticket numbers ───────────────────────────────────────────────────

/** Reserves the next ticket number up front (needed before the ticket row
 *  can be inserted, since the number gets embedded in the acknowledgement
 *  email's subject/link). Postgres sequences hand out a unique number even
 *  under heavy concurrent load or multiple backend instances. */
async function getNextTicketNumber() {
  const { rows } = await query(`SELECT nextval('ticket_number_seq') AS n`);
  return Number(rows[0].n);
}

// ── tickets ──────────────────────────────────────────────────────────

/** Inserts one ticket row + its first status-history entry, as a single
 *  transaction (so you never end up with a ticket that has no history). */
async function createTicket(fields) {
  const {
    ticketNumber,
    processInstanceId,
    source = 'email',
    businessKey,
    subject,
    description,
    customerName,
    customerEmail,
    productOrCategory,
    urgency,
    sentiment,
    receivedAt,
    callId = null,
    callerNumber = null,
    agentId = null,
    callAnsweredAt = null,
    callEndedAt = null,
    callDurationSeconds = null,
  } = fields;

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tickets (
         ticket_number, process_instance_id, source, business_key,
         subject, description, customer_name, customer_email,
         product_or_category, urgency, sentiment, ticket_status,
         received_at, call_id, caller_number, agent_id,
         call_answered_at, call_ended_at, call_duration_seconds
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OPEN',$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        ticketNumber, processInstanceId, source, businessKey,
        subject, description, customerName, customerEmail,
        productOrCategory, urgency, sentiment,
        receivedAt || new Date().toISOString(),
        callId, callerNumber, agentId, callAnsweredAt, callEndedAt, callDurationSeconds,
      ]
    );
    const ticket = rows[0];
    await client.query(
      `INSERT INTO ticket_status_history (ticket_id, status, changed_by) VALUES ($1, 'OPEN', 'system')`,
      [ticket.id]
    );
    return ticketRowToObject(ticket);
  });
}

async function getTicketByProcessInstanceId(processInstanceId) {
  const { rows } = await query(`SELECT * FROM tickets WHERE process_instance_id = $1`, [processInstanceId]);
  return ticketRowToObject(rows[0]);
}

async function getTicketByNumber(ticketNumber) {
  const { rows } = await query(`SELECT * FROM tickets WHERE ticket_number = $1`, [ticketNumber]);
  return ticketRowToObject(rows[0]);
}

async function getTicketByBusinessKey(businessKey) {
  const { rows } = await query(`SELECT * FROM tickets WHERE business_key = $1`, [businessKey]);
  return ticketRowToObject(rows[0]);
}

async function getTicketByBusinessKeyIn(candidateIds) {
  if (!candidateIds || !candidateIds.length) return null;
  const { rows } = await query(
    `SELECT * FROM tickets WHERE business_key = ANY($1::text[]) LIMIT 1`,
    [candidateIds]
  );
  return ticketRowToObject(rows[0]);
}

/** Fast, indexed replacement for a full scan over every Flowable process
 *  instance. */
async function getInstanceIdByTicketNumber(ticketNumber) {
  const n = Number(ticketNumber);
  if (!Number.isInteger(n)) return null;
  const ticket = await getTicketByNumber(n);
  return ticket ? ticket.processInstanceId : null;
}

/** Listing with optional filters — status, and role-based scoping.
 *  `scope` is derived server-side from the requester's JWT in server.js,
 *  never from client input:
 *    - null                            → no extra restriction
 *                                         (SUPER_ADMIN, SUPERVISOR, ZONAL_ADMIN)
 *    - { onlyUnassignedOrOwnZone: id }  → ZONAL_EXECUTIVE: unassigned
 *                                         tickets anywhere, plus ones
 *                                         already in their own zone
 *    - { assignedEngineerId: id }       → CUSTOMER_SUPPORT: only their own
 */
async function listTickets({ status, scope, zoneId, limit = 500 } = {}) {
  const clauses = [];
  const params = [];

  if (status) {
    params.push(status);
    clauses.push(`t.ticket_status = $${params.length}`);
  }

  // Zone filter used by Super Admin / Supervisor.
  // zoneId = 'none' -> tickets not yet assigned to any zone.
  if (zoneId === 'none') {
    clauses.push(`t.zone_id IS NULL`);
  } else if (zoneId) {
    params.push(Number(zoneId));
    clauses.push(`t.zone_id = $${params.length}`);
  }

  if (scope?.onlyUnassignedOrOwnZone) {
    params.push(scope.onlyUnassignedOrOwnZone);
    clauses.push(`(t.assigned_engineer_id IS NULL OR t.zone_id = $${params.length})`);
  } else if (scope?.assignedEngineerId) {
    params.push(scope.assignedEngineerId);
    clauses.push(`t.assigned_engineer_id = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);

  const { rows } = await query(
    `SELECT t.*, z.name AS zone_name
       FROM tickets t LEFT JOIN zones z ON z.id = t.zone_id
       ${where}
      ORDER BY t.last_activity_at DESC LIMIT $${params.length}`,
    params
  );
  return rows.map(ticketRowToObject);
}

/** Ticket counts per zone and status — powers the Super Admin / Supervisor
 *  dashboard. Tickets with no zone yet are reported as zoneId = null. */
async function getZoneStats() {
  const { rows } = await query(
    `SELECT t.zone_id, z.name AS zone_name, t.ticket_status, COUNT(*)::int AS count
       FROM tickets t LEFT JOIN zones z ON z.id = t.zone_id
      GROUP BY t.zone_id, z.name, t.ticket_status`
  );
  return rows.map((r) => ({
    zoneId: r.zone_id,
    zoneName: r.zone_name || 'Unassigned',
    status: r.ticket_status,
    count: r.count,
  }));
}

/** Assigns (or reassigns) a ticket to a customer-support agent.
 *
 *  Lock rule: once a ZONAL_EXECUTIVE has made the assignment, no further
 *  ZONAL_EXECUTIVE — from ANY zone — can change it. The DB update simply
 *  matches zero rows in that case, so there's no separate race-prone
 *  "check then update" step; the WHERE clause IS the enforcement.
 *  SUPER_ADMIN / SUPERVISOR / ZONAL_ADMIN bypass the lock (override). */
async function assignEngineer(processInstanceId, { engineerId, engineerName, assignedById, assignedByRole, zoneId }) {
  // NEW — Zonal Executive can now reassign too
const canOverride = ['SUPER_ADMIN', 'SUPERVISOR', 'ZONAL_ADMIN', 'ZONAL_EXECUTIVE'].includes(assignedByRole);
  const lockClause = canOverride ? '' : 'AND assignment_locked = FALSE';

  const { rows } = await query(
    `UPDATE tickets
        SET assigned_engineer_id = $1,
            assigned_engineer_name = $2,
            assigned_by_id = $3,
            assigned_by_role = $4,
            zone_id = COALESCE($5, zone_id),
            assignment_locked = TRUE,
            last_activity_at = now()
      WHERE process_instance_id = $6 ${lockClause}
      RETURNING *`,
    [engineerId, engineerName || engineerId, assignedById, assignedByRole, zoneId || null, processInstanceId]
  );

  if (!rows[0]) {
    // Either the ticket doesn't exist, or it's locked and this caller
    // can't override it — tell those apart for a clearer error upstream.
    const existing = await getTicketByProcessInstanceId(processInstanceId);
    if (!existing) return { notFound: true };
    if (existing.assignmentLocked) return { locked: true, ticket: existing };
    return { notFound: true };
  }

  return { ticket: ticketRowToObject(rows[0]) };
}

async function updateTicketStatus(processInstanceId, status, changedBy = null) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE tickets
         SET ticket_status = $1, last_activity_at = now()
       WHERE process_instance_id = $2
       RETURNING *`,
      [status, processInstanceId]
    );
    if (!rows[0]) return null;
    await client.query(
      `INSERT INTO ticket_status_history (ticket_id, status, changed_by) VALUES ($1,$2,$3)`,
      [rows[0].id, status, changedBy]
    );
    return ticketRowToObject(rows[0]);
  });
}

async function touchLastActivity(processInstanceId) {
  await query(`UPDATE tickets SET last_activity_at = now() WHERE process_instance_id = $1`, [processInstanceId]);
}

// ── comments ─────────────────────────────────────────────────────────

async function addComment(processInstanceId, { authorId, authorName, role = 'admin', text, visible = true, timestamp }) {
  return withTransaction(async (client) => {
    const ticketRes = await client.query(`SELECT id FROM tickets WHERE process_instance_id = $1`, [processInstanceId]);
    const ticket = ticketRes.rows[0];
    if (!ticket) throw new Error(`No ticket found for process instance ${processInstanceId}`);

    const { rows } = await client.query(
      `INSERT INTO ticket_comments (ticket_id, author_id, author_name, role, text, visible, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))
       RETURNING *`,
      [ticket.id, authorId || null, authorName || null, role, text, visible, timestamp || null]
    );
    await client.query(`UPDATE tickets SET last_activity_at = now() WHERE id = $1`, [ticket.id]);
    return commentRowToObject(rows[0]);
  });
}

async function getComments(processInstanceId, { visibleOnly = false } = {}) {
  const clause = visibleOnly ? 'AND c.visible = TRUE' : '';
  const { rows } = await query(
    `SELECT c.* FROM ticket_comments c
       JOIN tickets t ON t.id = c.ticket_id
      WHERE t.process_instance_id = $1 ${clause}
      ORDER BY c.created_at ASC`,
    [processInstanceId]
  );
  return rows.map(commentRowToObject);
}

async function setCommentVisibility(commentId, visible) {
  const { rows } = await query(
    `UPDATE ticket_comments SET visible = $1 WHERE id = $2 RETURNING *`,
    [visible, commentId]
  );
  return rows[0] ? commentRowToObject(rows[0]) : null;
}

// ── thread messages (email Message-Id tracking) ─────────────────────

async function addThreadMessageId(processInstanceId, messageId) {
  const { rows } = await query(`SELECT id FROM tickets WHERE process_instance_id = $1`, [processInstanceId]);
  const ticket = rows[0];
  if (!ticket) return;
  await query(
    `INSERT INTO ticket_thread_messages (ticket_id, message_id)
     VALUES ($1,$2)
     ON CONFLICT (ticket_id, message_id) DO NOTHING`,
    [ticket.id, messageId]
  );
}

/** Indexed replacement for a full scan over every running process
 *  instance's threadMessageIds. Returns the matching ticket's
 *  process_instance_id, or null. */
async function findTicketIdByMessageId(candidateIds) {
  if (!candidateIds || !candidateIds.length) return null;
  const { rows } = await query(
    `SELECT t.process_instance_id
       FROM ticket_thread_messages m
       JOIN tickets t ON t.id = m.ticket_id
      WHERE m.message_id = ANY($1::text[])
      LIMIT 1`,
    [candidateIds]
  );
  return rows[0]?.process_instance_id || null;
}

// ── status history ──────────────────────────────────────────────────

async function getStatusHistory(processInstanceId) {
  const { rows } = await query(
    `SELECT h.status, h.changed_by, h.changed_at
       FROM ticket_status_history h
       JOIN tickets t ON t.id = h.ticket_id
      WHERE t.process_instance_id = $1
      ORDER BY h.changed_at ASC`,
    [processInstanceId]
  );
  return rows.map((r) => ({ status: r.status, changedBy: r.changed_by, time: r.changed_at }));
}

// ── attachments ──────────────────────────────────────────────────────

async function addAttachment(processInstanceId, { filename, contentType, sizeBytes, storagePath, sourceMessageId }) {
  const { rows: t } = await query(`SELECT id FROM tickets WHERE process_instance_id = $1`, [processInstanceId]);
  if (!t[0]) throw new Error(`No ticket found for process instance ${processInstanceId}`);
  const { rows } = await query(
    `INSERT INTO ticket_attachments (ticket_id, filename, content_type, size_bytes, storage_path, source_message_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [t[0].id, filename, contentType || null, sizeBytes || null, storagePath, sourceMessageId || null]
  );
  return rows[0];
}

async function getAttachments(processInstanceId) {
  const { rows } = await query(
    `SELECT a.* FROM ticket_attachments a
       JOIN tickets t ON t.id = a.ticket_id
      WHERE t.process_instance_id = $1
      ORDER BY a.uploaded_at ASC`,
    [processInstanceId]
  );
  return rows;
}

// ── notification log ────────────────────────────────────────────────

async function logNotification(processInstanceId, { type, toEmail, messageId, success = true, errorMessage = null }) {
  const { rows: t } = await query(`SELECT id FROM tickets WHERE process_instance_id = $1`, [processInstanceId]);
  await query(
    `INSERT INTO notification_log (ticket_id, type, to_email, message_id, success, error_message)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [t[0]?.id || null, type, toEmail || null, messageId || null, success, errorMessage]
  );
}

async function getNotificationLog(processInstanceId) {
  const { rows } = await query(
    `SELECT n.* FROM notification_log n
       JOIN tickets t ON t.id = n.ticket_id
      WHERE t.process_instance_id = $1
      ORDER BY n.sent_at DESC`,
    [processInstanceId]
  );
  return rows;
}

module.exports = {
  getNextTicketNumber,
  createTicket,
  getTicketByProcessInstanceId,
  getTicketByNumber,
  getTicketByBusinessKey,
  getTicketByBusinessKeyIn,
  getInstanceIdByTicketNumber,
  listTickets,
  updateTicketStatus,
  assignEngineer,
  touchLastActivity,
  addComment,
  getComments,
  setCommentVisibility,
  addThreadMessageId,
  findTicketIdByMessageId,
  getStatusHistory,
  addAttachment,
  getAttachments,
  logNotification,
  getZoneStats,
  getNotificationLog,
};