// const express = require('express');
// const cors = require('cors');
// const cron = require('node-cron');
// require('dotenv').config();
// const {
//   FLOWABLE_BASE,
//   FLOWABLE_AUTH,
//   FLOWABLE_USER,
//   FLOWABLE_PASS,
//   flowableRequest,
//   getTask,
//   claimTask,
//   completeTask,
//   getProcessVariables,
//   saveProcessVariable,
//   appendComment,
//   getActiveTaskForInstance,
//   getStatusHistory,
//   getRuntimeInstances,
//   getHistoricInstances,
//   setCommentVisibility 
// } = require('./flowableClient');
// const { runIngestOnce } = require('./mailIngest');
// const { createTicketFromCall } = require('./callIngest');
// const { findUserByEmail, verifyUserPassword, getUserGroups, getGroupMembers } = require('./flowableClient');
// // (merge into your existing destructured require from './flowableClient' at the top)
// const { sendAcknowledgementEmail, sendCommentEmail } = require("./emailService");
// // ── Domain: Auth (backed by Flowable identity/groups) ──────────────────

// const GROUP_TO_ROLE = {
//   superadmin: 'SUPER_ADMIN',
//   zonemanager: 'ZONE_MANAGER',
//   zoneadmin: 'ZONE_ADMIN',
//   engineer: 'ENGINEER',
//   customercare: 'CUSTOMER_CARE',
// };
// const ENGINEER_GROUP_ID = process.env.ENGINEER_GROUP_ID || 'engineer';



// const app = express();
// app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
// app.use(express.json());


// app.post('/api/auth/login', async (req, res) => {
//   const { email, password } = req.body;
//   if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
//   try {
//     const user = await findUserByEmail(email);
//     if (!user) return res.status(401).json({ error: 'Invalid email or password' });

//     const ok = await verifyUserPassword(user.id, password);
//     if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

//     const groups = await getUserGroups(user.id);
//     const role = groups.map((g) => GROUP_TO_ROLE[g]).find(Boolean);
//     if (!role) return res.status(403).json({ error: 'This user is not in a recognized role group in Flowable.' });

//     res.json({
//       id: user.id,
//       name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.id,
//       email: user.email,
//       role,
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.response?.data || err.message });
//   }
// });

// /** GET /api/engineers — populates the Zone Manager's assignment dropdown. */
// app.get('/api/engineers', async (_req, res) => {
//   try {
//     const members = await getGroupMembers(ENGINEER_GROUP_ID);
//     res.json({
//       engineers: members.map((u) => ({
//         id: u.id,
//         name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.id,
//         email: u.email,
//       })),
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.response?.data || err.message });
//   }
// });

// /** PUT /api/tickets/:id/assign — { engineerId, engineerName } */
// app.put('/api/tickets/:id/assign', async (req, res) => {
//   const { engineerId, engineerName } = req.body;
//   if (!engineerId) return res.status(400).json({ error: 'engineerId is required' });
//   try {
//     await saveProcessVariable(req.params.id, 'assignedEngineerId', engineerId);
//     await saveProcessVariable(req.params.id, 'assignedEngineerName', engineerName || engineerId);
//     res.json({ success: true, assignedEngineerId: engineerId, assignedEngineerName: engineerName || engineerId });
//   } catch (err) {
//     res.status(500).json({ error: err.response?.data || err.message });
//   }
// });


// // ── Generic Flowable REST proxy (same pattern as the audit app) ────────
// // Frontend can still call /flowable-api/* directly for anything not
// // covered by the domain routes below (e.g. reading process history).
// app.use('/flowable-api', async (req, res) => {
//   const targetUrl = `${FLOWABLE_BASE}${req.path}`;
//   const queryString = Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '';
//   try {
//     const response = await require('axios')({
//       method: req.method,
//       url: targetUrl + queryString,
//       headers: { 'Content-Type': 'application/json', Authorization: FLOWABLE_AUTH },
//       data: ['POST', 'PUT'].includes(req.method) ? req.body : undefined,
//       timeout: 30000,
//     });
//     return res.status(response.status).json(response.data);
//   } catch (err) {
//     const status = err.response?.status || 500;
//     return res.status(status).json({ error: err.response?.data || err.message });
//   }
// });


// app.get('/api/tickets/:id/history', async (req, res) => {
//   try {
//     const history = await getStatusHistory(req.params.id);
//     res.json({ history });
//   } catch (err) {
//     res.status(500).json({ error: err.response?.data || err.message });
//   }
// });
// // ── Domain: Tickets ─────────────────────────────────────────────────────

// function variablesToObject(variables) {
//   const obj = {};
//   for (const v of variables) obj[v.name] = v.value;
//   return obj;
// }

// function toTicketSummary(inst) {
//   const vars = variablesToObject(inst.variables || []);
//   return {
//     id: inst.id,
//     createTime: inst.startTime || inst.createTime,
//     lastActivityAt: vars.lastActivityAt || inst.startTime || inst.createTime, // new
//     subject: vars.subject,
//     customerName: vars.customerName,
//     customerEmail: vars.customerEmail,
//     productOrCategory: vars.productOrCategory,
//     urgency: vars.urgency,
//     sentiment: vars.sentiment,
//     ticketStatus: vars.ticketStatus || "OPEN",
//     receivedAt: vars.receivedAt,

//     assignedEngineerId: vars.assignedEngineerId || null,
//     assignedEngineerName: vars.assignedEngineerName || null,
//   };
// }

// app.get('/api/tickets', async (req, res) => {
//   try {
//     const { role, userId } = req.query;
//     const [emailRunning, callRunning] = await Promise.all([
//       getRuntimeInstances('emailTicketWorkflow'),
//       getRuntimeInstances('callTicketWorkflow'),
//     ]);
//     let tickets = [...emailRunning, ...callRunning].map(toTicketSummary);
//     if (role === 'ENGINEER' && userId) {
//       tickets = tickets.filter((t) => t.assignedEngineerId === userId);
//     }
// tickets.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
//  res.json({ tickets });   
// } catch (err) {
//     res.status(500).json({ error: err.response?.data || err.message });
//   }
// });
// /** GET /api/tickets/:id — id is the processInstanceId. Works for both open
//  *  and closed tickets (getProcessVariables falls back to historic variable
//  *  instances once the process has finished), and for both email- and
//  *  call-sourced tickets alike — the id alone is enough, no
//  *  processDefinitionKey needed here. Also reports the active task, if any,
//  *  so the frontend knows whether status/comment actions are still
//  *  possible. */
// app.get('/api/tickets/:id', async (req, res) => {
//   try {
//     const vars = variablesToObject(await getProcessVariables(req.params.id));
//     const activeTask = await getActiveTaskForInstance(req.params.id);
//     let comments = [];
//     try {
//       comments = JSON.parse(vars.comments || '[]');
//     } catch {
//       comments = [];
//     }
//     res.json({ processInstanceId: req.params.id, taskId: activeTask?.id || null, variables: vars, comments });
//   } catch (err) {
//     res.status(500).json({ error: err.response?.data || err.message });
//   }
// });



// // ── Public ticket tracking (no auth) ────────────────────────────────────
// // Customer-facing view reached via the link in the acknowledgement email.
// // Deliberately excludes internal-only fields (assignedEngineerId/Name,
// // customerEmail is kept since it's the ticket owner's own info).
// app.get('/api/public/tickets/:id', async (req, res) => {
//   try {
//     const vars = variablesToObject(await getProcessVariables(req.params.id));
//     if (Object.keys(vars).length === 0) {
//       return res.status(404).json({ error: 'Ticket not found' });
//     }

//     let comments = [];
//     try {
//       comments = JSON.parse(vars.comments || '[]');
//     } catch {
//       comments = [];
//     }

//     console.log('[public] total comments:', comments.length, '— visible:', comments.filter((c) => c.visible !== false).length);

//     const history = await getStatusHistory(req.params.id);

//     res.json({
//       id: req.params.id,
//       subject: vars.subject,
//       description: vars.description,
//       productOrCategory: vars.productOrCategory,
//       urgency: vars.urgency,
//       sentiment: vars.sentiment,
//       status: vars.ticketStatus || 'OPEN',
//       receivedAt: vars.receivedAt,
//       comments: comments
//         .filter((c) => c.visible !== false)
//         .map((c) => ({ authorName: c.authorName || 'Support', text: c.text, timestamp: c.timestamp })),
//       history,
//     });
//   } catch (err) {
//     res.status(404).json({ error: 'Ticket not found' });
//   }
// });
// app.post('/api/tickets/:id/comments', async (req, res) => {
//   const { authorId, authorName, text, sendMail } = req.body;
//   if (!text || !text.trim()) return res.status(400).json({ error: 'Comment text is required' });

//   let comments;
//   try {
//     const comment = { authorId, authorName, role: 'admin', text: text.trim(), timestamp: new Date().toISOString() };
//     comments = await appendComment(req.params.id, comment);
//   } catch (err) {
//     console.error('[comments] failed to append comment:', err.response?.data || err.message);
//     return res.status(500).json({ error: err.response?.data || err.message || 'This ticket is closed and can no longer be commented on.' });
//   }

//   let mailSent = false;
//   let mailError = null;

//   if (sendMail) {
//     try {
//       const vars = variablesToObject(await getProcessVariables(req.params.id));
//       console.log('[comments] sendMail requested for ticket', req.params.id, '— customerEmail:', vars.customerEmail);

//       if (!vars.customerEmail) {
//         mailError = 'This ticket has no customerEmail variable set.';
//         console.warn('[comments]', mailError);
//       } else {
//         const ticketUrl = `${process.env.FRONTEND_BASE || 'http://localhost:5173'}/track/${req.params.id}`;
//         let lastMessageId;
//         try {
//           const thread = JSON.parse(vars.threadMessageIds || '[]');
//           lastMessageId = thread[thread.length - 1];
//         } catch {
//           lastMessageId = undefined;
//         }
//         const latestComment = comments[comments.length - 1];

//         console.log('[comments] sending comment email to', vars.customerEmail);
//         const info = await sendCommentEmail({
//           to: vars.customerEmail,
//           customerName: vars.customerName,
//           subject: vars.subject,
//           ticketId: req.params.id,
//           ticketUrl,
//           commentText: latestComment.text,
//           inReplyTo: lastMessageId,
//         });
//         console.log('[comments] ✅ comment email sent, messageId:', info?.messageId);
//         mailSent = true;
//       }
//     } catch (err) {
//       mailError = err.message;
//       console.error('[comments] ❌ failed to send comment email:', err.response?.data || err);
//     }
//   }

//   res.json({ comments, mailSent, mailError });
// });

// /** PUT /api/tickets/:id/comments/:commentId/visibility — { visible: boolean } */
// app.put('/api/tickets/:id/comments/:commentId/visibility', async (req, res) => {
//   const { visible } = req.body;
//   if (typeof visible !== 'boolean') return res.status(400).json({ error: 'visible (boolean) is required' });
//   try {
//     const comments = await setCommentVisibility(req.params.id, req.params.commentId, visible);
//     if (!comments) return res.status(404).json({ error: 'Comment not found' });
//     res.json({ comments });
//   } catch (err) {
//     res.status(500).json({ error: err.response?.data || err.message });
//   }
// });

// /** PUT /api/tickets/:id/status — { status: 'OPEN'|'IN_PROGRESS'|'RESOLVED'|'CLOSED', assignee? }
//  *  OPEN/IN_PROGRESS/RESOLVED just update the ticketStatus variable and keep
//  *  the task open for further triage — the ticket stays listed either way,
//  *  since the list is now built from process instances, not from a
//  *  candidate-group task query. CLOSED completes the task, which the BPMN
//  *  gateway routes to the end event; the ticket then keeps showing up via
//  *  the historic-instances half of GET /api/tickets. */
// app.put('/api/tickets/:id/status', async (req, res) => {
//   const { status, assignee } = req.body;
//   const VALID = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
//   if (!VALID.includes(status)) return res.status(400).json({ error: `status must be one of ${VALID.join(', ')}` });

//   try {
//     const task = await getActiveTaskForInstance(req.params.id);
//     if (!task) return res.status(400).json({ error: 'No active task found for this ticket.' });

//     if (assignee && task.assignee !== assignee) {
//       await claimTask(task.id, assignee);
//     }
//     await saveProcessVariable(req.params.id, 'ticketStatus', status);
// await saveProcessVariable(req.params.id, 'lastActivityAt', new Date().toISOString());
//     // No more completeTask() call — the process instance / task stays
//     // alive regardless of status, so status can always be changed later,
//     // including reopening a "closed" ticket.

//     res.json({ success: true, status });
//   } catch (err) {
//     res.status(500).json({ error: err.response?.data || err.message });
//   }
// });

// // ── Mail ingestion ───────────────────────────────────────────────────────

// /** POST /api/ingest/run — manual trigger (also useful for testing/demoing
//  *  without waiting on the cron schedule). */
// app.post('/api/ingest/run', async (_req, res) => {
//   try {
//     const results = await runIngestOnce();
//     res.json({ success: true, results });
//   } catch (err) {
//     res.status(500).json({ success: false, error: err.message });
//   }
// });

// // Poll the inbox every 2 minutes. Adjust via INGEST_CRON in .env
// // (cron syntax, e.g. '*/1 * * * *' for every minute).
// const INGEST_CRON = process.env.INGEST_CRON || '*/2 * * * *';
// cron.schedule(INGEST_CRON, () => {
//   runIngestOnce()
//     .then((results) => {
//       const created = results.filter((r) => !r.skipped && !r.error).length;
//       if (created) console.log(`[ingest] created ${created} ticket(s)`);
//     })
//     .catch((err) => console.error('[ingest] error:', err.message));
// });

// // ── Domain: Calls (CTI) ──────────────────────────────────────────────

// /** POST /api/calls/inbound — called by the CTI Adapter (softphone's
//  *  onInvite handler) the moment a call rings in. This does NOT create a
//  *  ticket yet — it just lets the frontend know a call is live so the
//  *  Agent Extension screen can pop with caller info pre-filled (BR-20).
//  *  Ticket creation happens only when the rep submits the form, via the
//  *  route below (BR-21). */
// app.post('/api/calls/inbound', async (req, res) => {
//   const { callId, callerNumber, agentId } = req.body;
//   if (!callerNumber) return res.status(400).json({ error: 'callerNumber is required' });
//   res.json({ received: true, callId, callerNumber, agentId });
// });

// /** POST /api/calls/:callId/create-ticket — rep submits the screen-pop form
//  *  while on the call (BR-21). Starts callTicketWorkflow (see
//  *  callIngest.js), deduped by callId so a retried request never creates a
//  *  second ticket for the same call (BR-23). Response is spread flat
//  *  (success/skipped/processInstanceId at the top level) to match what the
//  *  frontend's createTicketFromCall() in ticketApi.ts expects — previously
//  *  this nested the result under a "ticket" key, which is why the UI showed
//  *  "Ticket created: undefined". */
// app.post('/api/calls/:callId/create-ticket', async (req, res) => {
//   try {
//     const result = await createTicketFromCall({ callId: req.params.callId, ...req.body });
//     res.json({ success: true, ...result });
//   } catch (err) {
//     res.status(500).json({ error: err.response?.data || err.message });
//   }
// });

// app.get('/health', (_req, res) => res.json({ ok: true }));

// const PORT = process.env.PORT || 4000;
// app.listen(PORT, () => {
//   console.log(`\n🚀 PS QuickIt backend → http://localhost:${PORT}`);
//   console.log(`   Flowable      → ${FLOWABLE_BASE}`);
//   console.log(`   Flowable auth → ${FLOWABLE_USER}:${'*'.repeat(FLOWABLE_PASS.length)}`);
//   console.log(`   Ingest cron   → ${INGEST_CRON} (POST /api/ingest/run to trigger manually)`);
//   console.log(`   Routes        → /api/tickets, /api/tickets/:id, /api/tickets/:id/comments, /api/tickets/:id/status, /api/calls/inbound, /api/calls/:callId/create-ticket\n`);
// });


const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();

const {
  FLOWABLE_BASE,
  FLOWABLE_AUTH,
  FLOWABLE_USER,
  FLOWABLE_PASS,
  getActiveTaskForInstance,
  claimTask,
  saveProcessVariable,
  findUserByEmail,
  verifyUserPassword,
  getUserGroups,
  getGroupMembers,
} = require('./flowableClient');

const ticketsRepo = require('./ticketsRepo');
const { testConnection } = require('./db');
const { runIngestOnce } = require('./mailIngest');
const { createTicketFromCall } = require('./callIngest');
const { sendAcknowledgementEmail, sendCommentEmail } = require('./emailService');

// ── Domain: Auth (backed by Flowable identity/groups) ──────────────────

const GROUP_TO_ROLE = {
  superadmin: 'SUPER_ADMIN',
  zonemanager: 'ZONE_MANAGER',
  zoneadmin: 'ZONE_ADMIN',
  engineer: 'ENGINEER',
  customercare: 'CUSTOMER_CARE',
};
const ENGINEER_GROUP_ID = process.env.ENGINEER_GROUP_ID || 'engineer';

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  try {
    const user = await findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const ok = await verifyUserPassword(user.id, password);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    const groups = await getUserGroups(user.id);
    const role = groups.map((g) => GROUP_TO_ROLE[g]).find(Boolean);
    if (!role) return res.status(403).json({ error: 'This user is not in a recognized role group in Flowable.' });

    res.json({
      id: user.id,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.id,
      email: user.email,
      role,
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ── Domain: Engineers (cached in Postgres, refreshed on a timer) ───────

/** GET /api/engineers — populates the Zone Manager's assignment dropdown.
 *  Reads from the Postgres cache first (instant); if the cache is empty
 *  (first boot, before the refresh timer has run), falls back to asking
 *  Flowable directly and seeds the cache from that. */
app.get('/api/engineers', async (_req, res) => {
  try {
    let engineers = await ticketsRepo.listCachedEngineers();
    if (engineers.length === 0) {
      const members = await getGroupMembers(ENGINEER_GROUP_ID);
      engineers = members.map((u) => ({
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.id,
        email: u.email,
      }));
      if (engineers.length) await ticketsRepo.refreshEngineersCache(engineers);
    }
    res.json({ engineers });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

/** Keeps engineers_cache in sync with Flowable's 'engineer' group every
 *  5 minutes, so /api/engineers almost never has to call Flowable live. */
const ENGINEER_SYNC_MS = 5 * 60 * 1000;
async function syncEngineersCache() {
  try {
    const members = await getGroupMembers(ENGINEER_GROUP_ID);
    const engineers = members.map((u) => ({
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.id,
      email: u.email,
    }));
    await ticketsRepo.refreshEngineersCache(engineers);
  } catch (err) {
    console.error('[engineers-cache] refresh failed:', err.response?.data || err.message);
  }
}
setInterval(syncEngineersCache, ENGINEER_SYNC_MS);

/** PUT /api/tickets/:id/assign — { engineerId, engineerName } */
app.put('/api/tickets/:id/assign', async (req, res) => {
  const { engineerId, engineerName } = req.body;
  if (!engineerId) return res.status(400).json({ error: 'engineerId is required' });
  try {
    const ticket = await ticketsRepo.assignEngineer(req.params.id, engineerId, engineerName);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // Keep Flowable's active task assignee in sync too, so anything that
    // still looks at Flowable directly (e.g. the /flowable-api proxy)
    // shows the same assignee.
    const task = await getActiveTaskForInstance(req.params.id);
    if (task && task.assignee !== engineerId) {
      await claimTask(task.id, engineerId);
    }

    res.json({ success: true, assignedEngineerId: engineerId, assignedEngineerName: engineerName || engineerId });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ── Generic Flowable REST proxy (same pattern as the audit app) ────────
// Frontend can still call /flowable-api/* directly for anything not
// covered by the domain routes below (e.g. raw workflow inspection).
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

/** GET /api/tickets/:id/history — now reads ticket_status_history in
 *  Postgres instead of Flowable's historic-detail endpoint. Same shape
 *  the frontend already expects ({ status, time }), plus changedBy. */
app.get('/api/tickets/:id/history', async (req, res) => {
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

app.get('/api/tickets', async (req, res) => {
  try {
    const { role, userId, status } = req.query;
    const tickets = await ticketsRepo.listTickets({
      status: status || undefined,
      assignedEngineerId: role === 'ENGINEER' && userId ? userId : undefined,
    });
    res.json({ tickets: tickets.map(toTicketSummary) });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

/** GET /api/tickets/:id — id is the processInstanceId (kept as the public
 *  identifier so already-sent tracking links keep working). Ticket
 *  content + comments now come from Postgres; the active task is still
 *  asked of Flowable, since that's workflow state. */
app.get('/api/tickets/:id', async (req, res) => {
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
      },
      comments,
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ── Public ticket tracking (no auth) ────────────────────────────────────
// Customer-facing view reached via the link in the acknowledgement email.
// Path matches the frontend's TicketTrack.tsx fetch call exactly.
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

app.post('/api/tickets/:id/comments', async (req, res) => {
  const { authorId, authorName, text, sendMail } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Comment text is required' });

  let comment;
  try {
    comment = await ticketsRepo.addComment(req.params.id, {
      authorId,
      authorName,
      role: 'admin',
      text: text.trim(),
    });
  } catch (err) {
    console.error('[comments] failed to append comment:', err.message);
    return res.status(500).json({ error: err.message || 'Could not add comment to this ticket.' });
  }

  const comments = await ticketsRepo.getComments(req.params.id);

  let mailSent = false;
  let mailError = null;

  if (sendMail) {
    try {
      const ticket = await ticketsRepo.getTicketByProcessInstanceId(req.params.id);
      console.log('[comments] sendMail requested for ticket', req.params.id, '— customerEmail:', ticket?.customerEmail);

      if (!ticket?.customerEmail) {
        mailError = 'This ticket has no customer email on file.';
        console.warn('[comments]', mailError);
      } else {
        const ticketUrl = `${process.env.FRONTEND_BASE || 'http://localhost:5173'}/track/${req.params.id}`;

        console.log('[comments] sending comment email to', ticket.customerEmail);
        const info = await sendCommentEmail({
          to: ticket.customerEmail,
          customerName: ticket.customerName,
          subject: ticket.subject,
          ticketId: req.params.id,
          ticketUrl,
          commentText: comment.text,
        });
        console.log('[comments] ✅ comment email sent, messageId:', info?.messageId);
        mailSent = true;
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

  res.json({ comments, mailSent, mailError });
});

/** PUT /api/tickets/:id/comments/:commentId/visibility — { visible: boolean } */
app.put('/api/tickets/:id/comments/:commentId/visibility', async (req, res) => {
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

/** PUT /api/tickets/:id/status — { status: 'OPEN'|'IN_PROGRESS'|'RESOLVED'|'CLOSED', assignee? }
 *  Status lives in Postgres now (source of truth for listing/search) and
 *  is mirrored onto the Flowable process variable so the BPMN gateway and
 *  task list stay consistent. The task is never completed here, so a
 *  ticket can always be reopened later, same as before. */
app.put('/api/tickets/:id/status', async (req, res) => {
  const { status, assignee } = req.body;
  const VALID = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
  if (!VALID.includes(status)) return res.status(400).json({ error: `status must be one of ${VALID.join(', ')}` });

  try {
    const task = await getActiveTaskForInstance(req.params.id);
    if (!task) return res.status(400).json({ error: 'No active task found for this ticket.' });

    if (assignee && task.assignee !== assignee) {
      await claimTask(task.id, assignee);
    }

    const updated = await ticketsRepo.updateTicketStatus(req.params.id, status, assignee || null);
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

/** POST /api/calls/inbound — called by the CTI Adapter (softphone's
 *  onInvite handler) the moment a call rings in. This does NOT create a
 *  ticket yet — it just lets the frontend know a call is live so the
 *  Agent Extension screen can pop with caller info pre-filled (BR-20).
 *  Ticket creation happens only when the rep submits the form, via the
 *  route below (BR-21). */
app.post('/api/calls/inbound', async (req, res) => {
  const { callId, callerNumber, agentId } = req.body;
  if (!callerNumber) return res.status(400).json({ error: 'callerNumber is required' });
  res.json({ received: true, callId, callerNumber, agentId });
});

/** POST /api/calls/:callId/create-ticket — rep submits the screen-pop form
 *  while on the call (BR-21). Starts callTicketWorkflow (see
 *  callIngest.js), deduped by callId so a retried request never creates a
 *  second ticket for the same call (BR-23). */
app.post('/api/calls/:callId/create-ticket', async (req, res) => {
  try {
    const result = await createTicketFromCall({ callId: req.params.callId, ...req.body });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
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
  await syncEngineersCache();

  app.listen(PORT, () => {
    console.log(`\n🚀 PS QuickIt backend → http://localhost:${PORT}`);
    console.log(`   Flowable      → ${FLOWABLE_BASE}`);
    console.log(`   Flowable auth → ${FLOWABLE_USER}:${'*'.repeat(FLOWABLE_PASS.length)}`);
    console.log(`   Ingest cron   → ${INGEST_CRON} (POST /api/ingest/run to trigger manually)`);
    console.log(`   Routes        → /api/tickets, /api/tickets/:id, /api/tickets/:id/comments, /api/tickets/:id/status, /api/calls/inbound, /api/calls/:callId/create-ticket\n`);
  });
})();