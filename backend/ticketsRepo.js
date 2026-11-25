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
        createdById: row.created_by_id,
    createdByRole: row.created_by_role,
    ownerLeadId: row.owner_lead_id,
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
    zoneId = null,
    createdById = null,
    createdByRole = null,
    ownerLeadId = null,
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
         call_answered_at, call_ended_at, call_duration_seconds, zone_id,
         created_by_id, created_by_role, owner_lead_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OPEN',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        ticketNumber, processInstanceId, source, businessKey,
        subject, description, customerName, customerEmail,
        productOrCategory, urgency, sentiment,
        receivedAt || new Date().toISOString(),
        callId, callerNumber, agentId, callAnsweredAt, callEndedAt, callDurationSeconds,
        zoneId, createdById, createdByRole, ownerLeadId,
      ]
    );
    const ticket = rows[0];
    await client.query(
      `INSERT INTO ticket_status_history (ticket_id, status, changed_by) VALUES ($1, 'OPEN', $2)`,
      [ticket.id, createdById || 'system']
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
/** Listing with optional filters. `scope` comes from the verified JWT
 *  (see buildTicketScope in server.js), never from client input:
 *    null                         -> everything (SUPER_ADMIN, SUPERVISOR)
 *    { none: true }               -> nothing (zone-scoped user with no zone)
 *    { zoneOrUnrouted: zoneId }   -> ZONAL_ADMIN / MANAGER
 *    { leadId, zoneId }           -> LEAD: own team's tickets + unassigned email pool
 *    { agentId }                  -> CUSTOMER_SUPPORT: assigned to or created by them */
async function listTickets({ status, scope, zoneId, limit = 500 } = {}) {
  const clauses = [];
  const params = [];

  if (status) {
    params.push(status);
    clauses.push(`t.ticket_status = $${params.length}`);
  }

  if (zoneId === 'none') {
    clauses.push(`t.zone_id IS NULL`);
  } else if (zoneId) {
    params.push(Number(zoneId));
    clauses.push(`t.zone_id = $${params.length}`);
  }

  if (scope?.none) {
    clauses.push('FALSE');
  } else if (scope?.zoneOrUnrouted) {
    params.push(scope.zoneOrUnrouted);
    clauses.push(`(t.zone_id IS NULL OR t.zone_id = $${params.length})`);
  } else if (scope?.leadId) {
    params.push(scope.zoneId);
    const zi = params.length;
    params.push(String(scope.leadId));
    const li = params.length;
    clauses.push(
      `((t.zone_id IS NULL OR t.zone_id = $${zi})
        AND (
          t.owner_lead_id::text = $${li}::text
          OR t.assigned_engineer_id::text IN (
               SELECT u.id::text FROM users u WHERE u.created_by::text = $${li}::text)
          OR (t.created_by_id IS NULL AND t.assigned_engineer_id IS NULL)
        ))`
    );
  } else if (scope?.agentId) {
    params.push(String(scope.agentId));
    clauses.push(
      `(t.assigned_engineer_id::text = $${params.length}::text OR t.created_by_id::text = $${params.length}::text)`
    );
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
/** Assigns (or reassigns) a ticket to a customer-support agent.
 *
 *  Lock rule: once assigned, the ticket is locked.
 *    - SUPER_ADMIN / SUPERVISOR / ZONAL_ADMIN / MANAGER can always override.
 *    - A LEAD can only (re)assign if the ticket is unlocked OR they made the
 *      current assignment themselves (so they can't override another lead).
 *  The WHERE clause IS the enforcement, so there's no race-prone
 *  "check then update" step. */
async function assignEngineer(processInstanceId, { engineerId, engineerName, assignedById, assignedByRole, zoneId }) {
  const overrideRoles = ['SUPER_ADMIN', 'SUPERVISOR', 'ZONAL_ADMIN', 'MANAGER'];
  const lockClause = overrideRoles.includes(assignedByRole)
    ? ''
    : 'AND (assignment_locked = FALSE OR assigned_by_id::text = $3::text)';

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

/** The few fields needed to decide whether a user may touch a ticket. */
/** The few fields needed to decide whether a user may touch a ticket. */
async function getAccessInfo(processInstanceId) {
  const { rows } = await query(
    `SELECT t.zone_id, t.created_by_id, t.owner_lead_id, t.assigned_engineer_id,
            (SELECT u.created_by FROM users u
              WHERE u.id::text = t.assigned_engineer_id::text LIMIT 1) AS agent_lead_id
       FROM tickets t
      WHERE t.process_instance_id = $1`,
    [processInstanceId]
  );
  return rows[0] || null;
}

/** Which of these email Message-IDs are already a ticket or part of a thread? */
async function getKnownMessageIds(ids) {
  if (!ids || !ids.length) return new Set();
  const { rows } = await query(
    `SELECT business_key AS id FROM tickets WHERE business_key = ANY($1::text[])
     UNION
     SELECT message_id AS id FROM ticket_thread_messages WHERE message_id = ANY($1::text[])`,
    [ids]
  );
  return new Set(rows.map((r) => r.id));
}
/** Most recent ticket from this sender with this (Re:/Fwd:-stripped) subject, last 30 days. */
async function findOpenTicketBySenderAndSubject(email, normalizedSubject) {
  if (!email || !normalizedSubject) return null;
  const { rows } = await query(
    `SELECT process_instance_id FROM tickets
      WHERE lower(customer_email) = lower($1)
        AND lower(regexp_replace(subject, '^\\s*((re|fwd?|fw)\\s*:\\s*)+', '', 'i')) = $2
        AND created_at > now() - interval '30 days'
      ORDER BY created_at DESC LIMIT 1`,
    [email, normalizedSubject]
  );
  return rows[0]?.process_instance_id || null;
}
module.exports = {
  getNextTicketNumber,
  findOpenTicketBySenderAndSubject,
  getKnownMessageIds,
  getAccessInfo,
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