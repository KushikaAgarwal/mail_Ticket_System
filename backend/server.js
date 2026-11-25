const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();
const usersRepo = require('./usersRepo');
const { signToken, requireAuth, requireRole } = require('./authMiddleware');
const {
  FLOWABLE_BASE,
  FLOWABLE_AUTH,
  FLOWABLE_USER,
  FLOWABLE_PASS,
  getActiveTaskForInstance,
  claimTask,
  saveProcessVariable,
} = require('./flowableClient');

const ticketsRepo = require('./ticketsRepo');
const { testConnection } = require('./db');
const { runIngestOnce } = require('./mailIngest');

const { sendCommentEmail, sendCredentialsEmail, sendPasswordResetEmail } = require('./emailService');

// ── Role helpers ─────────────────────────────────────────────────────
// Hierarchy: SUPER_ADMIN > SUPERVISOR > ZONAL_ADMIN > MANAGER > LEAD > CUSTOMER_SUPPORT

// Roles allowed to assign tickets / view the support roster.
const ASSIGNER_ROLES = ['LEAD', 'MANAGER', 'ZONAL_ADMIN', 'SUPERVISOR', 'SUPER_ADMIN'];

// Roles that can see every zone (and filter by zone).
const ALL_ZONE_ROLES = ['SUPER_ADMIN', 'SUPERVISOR'];

/** Which Customer Support agents may this user assign tickets to?
 *  Derived from the verified JWT — never from client input. */
async function rosterFor(user, zoneIdFromQuery) {
  switch (user.role) {
    case 'LEAD':
      return usersRepo.listCustomerSupportForLead(user.id); // own team only
    case 'MANAGER':
    case 'ZONAL_ADMIN':
      if (!user.zoneId) return [];
      return usersRepo.listCustomerSupportInZone(user.zoneId); // own zone only
    default: // SUPER_ADMIN / SUPERVISOR
      return zoneIdFromQuery
        ? usersRepo.listCustomerSupportInZone(zoneIdFromQuery)
        : usersRepo.listAllCustomerSupport();
  }
}

/** Ticket-listing scope for each role (see ticketsRepo.listTickets). */
function buildTicketScope(user) {
  switch (user.role) {
    case 'ZONAL_ADMIN':
    case 'MANAGER':
      return user.zoneId ? { zoneOrUnrouted: user.zoneId } : { none: true };
    case 'LEAD':
      return user.zoneId ? { leadId: user.id, zoneId: user.zoneId } : { none: true };
    case 'CUSTOMER_SUPPORT':
      return { assignedEngineerId: user.id };
    default:
      return null; // SUPER_ADMIN / SUPERVISOR → see all
  }
}

// ── Domain: Auth (backed by Postgres users table — see usersRepo.js) ──

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

app.get('/api/zones', async (_req, res) => {
  res.json({ zones: await usersRepo.listZones() });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password, zoneId } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  try {
    const user = await usersRepo.verifyLogin(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    // Zone confirmation step — purely a UI check, not new security (the
    // backend already scopes every request by the account's real zoneId
    // regardless of what's selected here). Only applies to zone-scoped
    // roles; SUPER_ADMIN/SUPERVISOR have no zone and skip this.
    if (user.zoneId != null) {
      if (!zoneId) {
        return res.status(400).json({ error: 'Please select your zone.' });
      }
      if (Number(zoneId) !== Number(user.zoneId)) {
        return res.status(401).json({ error: 'Selected zone does not match this account.' });
      }
    }

    const token = signToken(user);
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── List team members (scoped by the requester's role) ───────────────
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const users = await usersRepo.listUsers(req.user, { role: req.query.role });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Customer Support roster (assignment dropdown) ────────────────────
// LEAD -> their own team; MANAGER/ZONAL_ADMIN -> their zone;
// SUPERVISOR/SUPER_ADMIN -> ?zoneId=… or everyone.
app.get('/api/customer-support', requireAuth, requireRole(...ASSIGNER_ROLES), async (req, res) => {
  try {
    const users = await rosterFor(req.user, req.query.zoneId);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Assign / reassign a ticket to a Customer Support agent ──────────
app.put('/api/tickets/:id/assign', requireAuth, requireRole(...ASSIGNER_ROLES), async (req, res) => {
  const { engineerId, engineerName } = req.body;
  if (!engineerId) return res.status(400).json({ error: 'engineerId is required' });

  try {
    // The target must be in THIS user's allowed roster — checked
    // server-side, not trusted from whatever the dropdown sent.
    const roster = await rosterFor(req.user);
    const match = roster.find((u) => u.id === engineerId);
    if (!match) {
      const msg =
        req.user.role === 'LEAD'
          ? 'That agent is not in your team.'
          : req.user.role === 'MANAGER' || req.user.role === 'ZONAL_ADMIN'
          ? 'That agent is not in your zone.'
          : 'That user is not an active Customer Support agent.';
      return res.status(403).json({ error: msg });
    }

    const result = await ticketsRepo.assignEngineer(req.params.id, {
      engineerId,
      engineerName,
      assignedById: req.user.id,
      assignedByRole: req.user.role,
      zoneId: match.zoneId, // the AGENT's zone, not the assigner's
    });

    if (result.notFound) return res.status(404).json({ error: 'Ticket not found' });
    if (result.locked) {
      return res.status(409).json({
        error: `This ticket was already assigned by another lead and can't be reassigned by you.`,
      });
    }

    res.json({ success: true, assignedEngineerId: engineerId, assignedEngineerName: engineerName || engineerId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generic Flowable REST proxy (same pattern as the audit app) ────────
app.use('/flowable-api', async (req, res) => {
  const targetUrl = `${FLOWABLE_BASE}${req.path}`;
  const queryString = Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '';
  try {
    const response = await require('axios')({
      method: req.method,
      url: targetUrl + queryString,
      headers: { 'Content-Type': 'application/json', Authorization: FLOWABLE_AUTH },
      data: ['POST', 'PUT'].includes(req.method) ? req.body : undefined,
      timeout: 30000,
    });
    return res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    return res.status(status).json({ error: err.response?.data || err.message });
  }
});

/** GET /api/tickets/:id/history — reads ticket_status_history in
 *  Postgres instead of Flowable's historic-detail endpoint. */
app.get('/api/tickets/:id/history', requireAuth, async (req, res) => {
  try {
    const history = await ticketsRepo.getStatusHistory(req.params.id);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ── Domain: Tickets ─────────────────────────────────────────────────────

function toTicketSummary(t) {
  return {
    id: t.processInstanceId,
    ticketNumber: t.ticketNumber,
    zoneId: t.zoneId || null,
    zoneName: t.zoneName || null,
    createTime: t.createdAt,
    lastActivityAt: t.lastActivityAt,
    subject: t.subject,
    customerName: t.customerName,
    customerEmail: t.customerEmail,
    productOrCategory: t.productOrCategory,
    urgency: t.urgency,
    sentiment: t.sentiment,
    ticketStatus: t.ticketStatus || 'OPEN',
    receivedAt: t.receivedAt,
    assignedEngineerId: t.assignedEngineerId || null,
    assignedEngineerName: t.assignedEngineerName || null,
  };
}

/** GET /api/stats/zones — ticket counts per zone and status.
 *  Super Admin and Supervisor only. */
app.get('/api/stats/zones', requireAuth, requireRole('SUPER_ADMIN', 'SUPERVISOR'), async (_req, res) => {
  try {
    res.json({ stats: await ticketsRepo.getZoneStats() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/tickets — role-scoped list (see buildTicketScope above).
 *  SUPER_ADMIN / SUPERVISOR see everything; ZONAL_ADMIN and MANAGER see
 *  their own zone (plus not-yet-routed tickets); LEAD sees their zone's
 *  unassigned pool plus their team's tickets; CUSTOMER_SUPPORT sees only
 *  their own. */
app.get('/api/tickets', requireAuth, async (req, res) => {
  try {
    const { status, zoneId } = req.query;
    const scope = buildTicketScope(req.user);

    // Zone filter is only honoured for roles that can see every zone.
    const canFilterByZone = ALL_ZONE_ROLES.includes(req.user.role);

    const tickets = await ticketsRepo.listTickets({
      status: status || undefined,
      zoneId: canFilterByZone ? zoneId || undefined : undefined,
      scope,
    });
    res.json({ tickets: tickets.map(toTicketSummary) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/tickets/:id — id is the processInstanceId (kept as the public
 *  identifier so already-sent tracking links keep working). */
app.get('/api/tickets/:id', requireAuth, async (req, res) => {
  try {
    const ticket = await ticketsRepo.getTicketByProcessInstanceId(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const [activeTask, comments] = await Promise.all([
      getActiveTaskForInstance(req.params.id),
      ticketsRepo.getComments(req.params.id),
    ]);

    res.json({
      processInstanceId: req.params.id,
      taskId: activeTask?.id || null,
      variables: {
        subject: ticket.subject,
        description: ticket.description,
        customerName: ticket.customerName,
        customerEmail: ticket.customerEmail,
        productOrCategory: ticket.productOrCategory,
        urgency: ticket.urgency,
        sentiment: ticket.sentiment,
        ticketStatus: ticket.ticketStatus,
        receivedAt: ticket.receivedAt,
        assignedEngineerId: ticket.assignedEngineerId,
        assignedEngineerName: ticket.assignedEngineerName,
        assignedById: ticket.assignedById,  
        assignmentLocked: ticket.assignmentLocked,
      },
      comments,
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ── Public ticket tracking (no auth) ────────────────────────────────────
// Customer-facing view reached via the link in the acknowledgement email.
// Deliberately the ONLY ticket route without requireAuth.
app.get('/api/public/tickets/:id', async (req, res) => {
  try {
    const ticket = await ticketsRepo.getTicketByProcessInstanceId(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const [comments, history] = await Promise.all([
      ticketsRepo.getComments(req.params.id, { visibleOnly: true }),
      ticketsRepo.getStatusHistory(req.params.id),
    ]);

    res.json({
      id: req.params.id,
      ticketNumber: ticket.ticketNumber, 
      subject: ticket.subject,
      description: ticket.description,
      productOrCategory: ticket.productOrCategory,
      urgency: ticket.urgency,
      sentiment: ticket.sentiment,
      status: ticket.ticketStatus || 'OPEN',
      receivedAt: ticket.receivedAt,
      comments: comments.map((c) => ({ authorName: c.authorName || 'Support', text: c.text, timestamp: c.timestamp })),
      history,
    });
  } catch (err) {
    res.status(404).json({ error: 'Ticket not found' });
  }
});

app.post('/api/tickets/:id/comments', requireAuth, async (req, res) => {
  const { authorId, authorName, text, sendMail } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Comment text is required' });

  let comment;
  try {
    // Hidden from the customer by default. It only becomes visible on the
    // tracking page once the email has really been sent (below).
    comment = await ticketsRepo.addComment(req.params.id, {
      authorId,
      authorName,
      role: 'admin',
      text: text.trim(),
      visible: false,
    });
  } catch (err) {
    console.error('[comments] failed to append comment:', err.message);
    return res.status(500).json({ error: err.message || 'Could not add comment to this ticket.' });
  }

  let mailSent = false;
  let mailError = null;

  if (sendMail) {
    try {
      const ticket = await ticketsRepo.getTicketByProcessInstanceId(req.params.id);

      if (!ticket?.customerEmail) {
        mailError = 'This ticket has no customer email on file.';
        console.warn('[comments]', mailError);
      } else {
        const ticketUrl = `${process.env.FRONTEND_BASE || 'http://localhost:5173'}/track/${req.params.id}`;

        const info = await sendCommentEmail({
          to: ticket.customerEmail,
          customerName: ticket.customerName,
          subject: ticket.subject,
          ticketId: ticket.ticketNumber,
          ticketUrl,
          commentText: comment.text,
        });
        console.log('[comments] ✅ comment email sent, messageId:', info?.messageId);
        mailSent = true;

        // Emailed to the customer, so it now shows on their tracking page too.
        await ticketsRepo.setCommentVisibility(comment.id, true);

        await ticketsRepo.logNotification(req.params.id, {
          type: 'COMMENT',
          toEmail: ticket.customerEmail,
          messageId: info?.messageId,
          success: true,
        });
        if (info?.messageId) {
          await ticketsRepo.addThreadMessageId(req.params.id, info.messageId);
        }
      }
    } catch (err) {
      mailError = err.message;
      console.error('[comments] ❌ failed to send comment email:', err.response?.data || err);
      await ticketsRepo.logNotification(req.params.id, {
        type: 'COMMENT',
        success: false,
        errorMessage: err.message,
      });
    }
  }

  const comments = await ticketsRepo.getComments(req.params.id);
  res.json({ comments, mailSent, mailError });
});

/** PUT /api/tickets/:id/comments/:commentId/visibility — { visible: boolean } */
app.put('/api/tickets/:id/comments/:commentId/visibility', requireAuth, async (req, res) => {
  const { visible } = req.body;
  if (typeof visible !== 'boolean') return res.status(400).json({ error: 'visible (boolean) is required' });
  try {
    const updated = await ticketsRepo.setCommentVisibility(req.params.commentId, visible);
    if (!updated) return res.status(404).json({ error: 'Comment not found' });
    const comments = await ticketsRepo.getComments(req.params.id);
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

/** PUT /api/tickets/:id/status — { status: 'OPEN'|'IN_PROGRESS'|'RESOLVED'|'CLOSED' }
 *  Status lives in Postgres (source of truth for listing/search) and is
 *  mirrored onto the Flowable process variable so the BPMN gateway and
 *  task list stay consistent. The task is never completed here, so a
 *  ticket can always be reopened later. */
app.put('/api/tickets/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const VALID = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
  if (!VALID.includes(status)) return res.status(400).json({ error: `status must be one of ${VALID.join(', ')}` });

  try {
    const task = await getActiveTaskForInstance(req.params.id);
    if (!task) return res.status(400).json({ error: 'No active task found for this ticket.' });

    const updated = await ticketsRepo.updateTicketStatus(req.params.id, status, req.user.id);
    if (!updated) return res.status(404).json({ error: 'Ticket not found' });

    await saveProcessVariable(req.params.id, 'ticketStatus', status);

    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ── Mail ingestion ───────────────────────────────────────────────────────

/** POST /api/ingest/run — manual trigger (also useful for testing/demoing
 *  without waiting on the cron schedule). */
app.post('/api/ingest/run', async (_req, res) => {
  try {
    const results = await runIngestOnce();
    res.json({ success: true, results });
  } catch (err) {
    console.error('[ingest route] full error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/customer-support/all', requireAuth, requireRole('SUPER_ADMIN', 'SUPERVISOR'), async (req, res) => {
  try {
    const users = await usersRepo.listAllCustomerSupport();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Poll the inbox every 2 minutes. Adjust via INGEST_CRON in .env
// (cron syntax, e.g. '*/1 * * * *' for every minute).
const INGEST_CRON = process.env.INGEST_CRON || '*/2 * * * *';
cron.schedule(INGEST_CRON, () => {
  runIngestOnce()
    .then((results) => {
      const created = results.filter((r) => !r.skipped && !r.error).length;
      if (created) console.log(`[ingest] created ${created} ticket(s)`);
    })
    .catch((err) => console.error('[ingest] error:', err.message));
});

// ── Domain: Calls (CTI) ──────────────────────────────────────────────

/** POST /api/calls/inbound — called by the CTI Adapter the moment a call
 *  rings in. Does NOT create a ticket yet; it just lets the frontend know
 *  a call is live (BR-20). */
app.post('/api/calls/inbound', async (req, res) => {
  const { callId, callerNumber, agentId } = req.body;
  if (!callerNumber) return res.status(400).json({ error: 'callerNumber is required' });
  res.json({ received: true, callId, callerNumber, agentId });
});

// app.post('/api/calls/:callId/create-ticket', async (req, res) => {
//   try {
//     const result = await createTicketFromCall({ callId: req.params.callId, ...req.body });
//     res.json({ success: true, ...result });
//   } catch (err) {
//     res.status(500).json({ error: err.response?.data || err.message });
//   }
// });

// ── Create a subordinate account (hierarchy enforced in usersRepo) ──────
app.post('/api/users', requireAuth, async (req, res) => {
  const { name, email, password, role, zoneId } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password, and role are required' });
  }
  try {
    const created = await usersRepo.createSubordinate(req.user, { name, email, password, role, zoneId });

    // Send the new account its login credentials. Failure here shouldn't
    // fail account creation — it's already logged inside emailService.
    const loginUrl = `${process.env.FRONTEND_BASE}/login`;
    await sendCredentialsEmail({
      to: email,
      name,
      email,
      password,
      role,
      loginUrl,
    });

    res.json({ user: created });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

/** POST /api/auth/forgot-password — { email }
 *  Always responds the same way whether or not the email exists, so the
 *  endpoint can't be used to check which emails have accounts. */
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  try {
    const result = await usersRepo.createPasswordResetToken(email);
    if (result) {
      const resetUrl = `${process.env.FRONTEND_BASE || 'http://localhost:5173'}/reset-password/${result.rawToken}`;
      await sendPasswordResetEmail({ to: result.user.email, name: result.user.name, resetUrl });
    }
    res.json({ success: true, message: 'Reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/auth/reset-password — { token, newPassword } */
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'token and newPassword are required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  try {
    const result = await usersRepo.resetPasswordWithToken(token, newPassword);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', async (_req, res) => {
  const dbOk = await testConnection().catch(() => false);
  res.json({ ok: true, db: dbOk });
});

const PORT = process.env.PORT || 4000;

(async () => {
  try {
    await testConnection();
    console.log('   Postgres      → connected');
  } catch (err) {
    console.error('   Postgres      → FAILED TO CONNECT:', err.message);
    console.error('   Check DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS in .env');
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 PS QuickIt backend → http://localhost:${PORT}`);
  });
})();