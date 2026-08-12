const axios = require('axios');
const crypto = require('crypto');
const FLOWABLE_USER = process.env.FLOWABLE_USER || 'admin';
const FLOWABLE_PASS = process.env.FLOWABLE_PASS || 'admin';
const FLOWABLE_BASE = process.env.FLOWABLE_BASE || 'http://localhost:8080/flowable-ui/process-api';

const FLOWABLE_AUTH = 'Basic ' + Buffer.from(`${FLOWABLE_USER}:${FLOWABLE_PASS}`).toString('base64');

const headers = {
  'Content-Type': 'application/json',
  Authorization: FLOWABLE_AUTH,
};

async function flowableRequest(method, path, data, params) {
  const url = `${FLOWABLE_BASE}${path}`;
  try {
    const response = await axios({ method, url, headers, data, params, timeout: 30000 });
    return response.data;
  } catch (err) {
    console.error(`[flowable] ${method} ${path} failed:`, err.response?.status, err.response?.data);
    throw err;
  }
}

function toVariable(name, value, type = 'string') {
  return { name, value, type };
}

/** Starts one process instance per ticket. `businessKey` is set to the
 *  Gmail message id (email tickets) or the SIP callId (call tickets) so
 *  the ingestion service can skip a source it has already turned into a
 *  ticket, even across restarts. `processDefinitionKey` defaults to
 *  'emailTicketWorkflow' so mailIngest.js's existing 2-argument calls
 *  keep working unchanged — callIngest.js passes 'callTicketWorkflow'
 *  explicitly as the 3rd argument. */
async function startTicketProcess(variables, businessKey, processDefinitionKey = 'emailTicketWorkflow') {
  return flowableRequest('POST', '/runtime/process-instances', {
    processDefinitionKey,
    businessKey,
    variables: variables.map((v) => toVariable(v.name, v.value, v.type || 'string')),
  });
}

async function getTask(taskId) {
  return flowableRequest('GET', `/runtime/tasks/${taskId}`);
}

async function claimTask(taskId, userId) {
  return flowableRequest('POST', `/runtime/tasks/${taskId}`, { action: 'claim', assignee: userId });
}

async function completeTask(taskId, variables = []) {
  return flowableRequest('POST', `/runtime/tasks/${taskId}`, {
    action: 'complete',
    variables: variables.length ? variables.map((v) => toVariable(v.name, v.value, v.type || 'string')) : undefined,
  });
}

async function getProcessVariables(processInstanceId) {
  try {
    return await flowableRequest('GET', `/runtime/process-instances/${processInstanceId}/variables`);
  } catch (err) {
    if (err.response?.status === 404) {
      const hist = await flowableRequest('GET', '/history/historic-variable-instances', null, {
        processInstanceId,
        size: 200,
      });
      return (hist.data || []).map((v) => ({
        name: v.variable?.name,
        value: v.variable?.value,
        type: v.variable?.type || 'string',
      }));
    }
    throw err;
  }
}
/** Every historical value the `ticketStatus` variable has held for this
 *  process instance, oldest first — Flowable records one historic-detail
 *  entry per variable *update* (not just current value), so this gives us
 *  a full status timeline for free. */
async function getStatusHistory(processInstanceId) {
  const data = await flowableRequest('GET', '/history/historic-detail', null, {
    processInstanceId,
    variableName: 'ticketStatus',
    selectOnlyVariableUpdates: true,
    sort: 'time',
    order: 'asc',
    size: 200,
  });
  return (data.data || []).map((d) => ({
    status: d.variable?.value,
    time: d.time,
  }));
}

async function saveProcessVariable(processInstanceId, name, value) {
  const body = toVariable(name, value);
  try {
    await flowableRequest('PUT', `/runtime/process-instances/${processInstanceId}/variables/${name}`, body);
  } catch (err) {
    if (err.response?.status === 404) {
      await flowableRequest('POST', `/runtime/process-instances/${processInstanceId}/variables`, [body]);
    } else {
      throw err;
    }
  }
}

/** Ticket comments are stored as a JSON array in the `comments` process
 *  variable (same approach the audit app uses) — simplest thing that works
 *  without a separate DB table, and it shows up automatically in Flowable's
 *  own process-instance variable history. */
/** Ticket comments are stored as a JSON array in the `comments` process
 *  variable. Every comment gets an `id` (for visibility toggling) and a
 *  `visible` flag (defaults true) so admins can hide a comment from the
 *  customer-facing tracking page without deleting it. */
async function appendComment(processInstanceId, comment) {
  const vars = await getProcessVariables(processInstanceId);
  const existing = vars.find((v) => v.name === 'comments');
  let list = [];
  if (existing?.value) {
    try {
      list = JSON.parse(String(existing.value));
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
  }
  const finalComment = {
    ...comment,
    id: comment.id || crypto.randomUUID(),
    visible: comment.visible !== undefined ? comment.visible : true,
  };
  list.push(finalComment);
  await saveProcessVariable(processInstanceId, 'comments', JSON.stringify(list));
  await saveProcessVariable(processInstanceId, 'lastActivityAt', new Date().toISOString());
  return list;
}

/** Toggles/sets a specific comment's visibility to the customer, matched
 *  by its `id` since comments have no native identifier of their own. */
async function setCommentVisibility(processInstanceId, commentId, visible) {
  const vars = await getProcessVariables(processInstanceId);
  const existing = vars.find((v) => v.name === 'comments');
  let list = [];
  if (existing?.value) {
    try {
      list = JSON.parse(String(existing.value));
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
  }
  const idx = list.findIndex((c) => c.id === commentId);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], visible };
  await saveProcessVariable(processInstanceId, 'comments', JSON.stringify(list));
  await saveProcessVariable(processInstanceId, 'lastActivityAt', new Date().toISOString());
  return list;
}

async function getRuntimeInstances(processDefinitionKey) {
  const data = await flowableRequest('GET', '/runtime/process-instances', null, {
    processDefinitionKey,
    includeProcessVariables: true,
    size: 200,
  });
  return data.data || [];
}

/** Completed (CLOSED) tickets — the process instance itself is the only
 *  thing that still exists once its task is completed, so this is how
 *  closed tickets stay visible in the list at all. */
async function getHistoricInstances(processDefinitionKey) {
  const data = await flowableRequest('GET', '/history/historic-process-instances', null, {
    processDefinitionKey,
    finished: true,
    includeProcessVariables: true,
    size: 200,
  });
  return data.data || [];
}

/** The one active reviewTicket task for a given process instance, or null
 *  if the ticket has already been closed (task completed). Used instead of
 *  candidate-group task queries for anything instance-specific, since a
 *  claimed task drops out of candidate-group results. */
async function getActiveTaskForInstance(processInstanceId) {
  const data = await flowableRequest('GET', '/runtime/tasks', null, { processInstanceId, size: 1 });
  return (data.data || [])[0] || null;
}

// NOTE: Flowable's REST API uses different business-key query param names
// on the runtime vs. history endpoints ('businessKey' vs
// 'processInstanceBusinessKey'), and depending on Flowable version an
// unrecognized param can be silently ignored rather than erroring — which
// would make the query return ANY matching processDefinitionKey instance,
// not just ones with the given business key. Rather than depend on getting
// the exact param name right, we send both possible param names (harmless
// if one is unrecognized) and then verify the result's businessKey
// client-side before treating it as a real match. This makes the dedupe
// check correct even if Flowable's filtering silently no-ops.
async function getRuntimeInstanceByBusinessKey(processDefinitionKey, businessKey) {
  const data = await flowableRequest('GET', '/runtime/process-instances', null, {
    processDefinitionKey,
    businessKey,
    processInstanceBusinessKey: businessKey,
    size: 50,
  });
  return (data.data || []).find((inst) => inst.businessKey === businessKey) || null;
}

async function getHistoricInstanceByBusinessKey(processDefinitionKey, businessKey) {
  const data = await flowableRequest('GET', '/history/historic-process-instances', null, {
    processDefinitionKey,
    processInstanceBusinessKey: businessKey,
    businessKey,
    size: 50,
  });
  return (data.data || []).find((inst) => inst.businessKey === businessKey) || null;
}

/** Looks up a Flowable user by email using admin credentials — this is
 *  just an identity lookup, not a password check. */
async function findUserByEmail(email) {
  const data = await flowableRequest('GET', '/identity/users', null, { email });
  return (data.data || [])[0] || null;
}

/** Verifies a password by making an authenticated request AS that user
 *  (Basic Auth userId:password) instead of the admin credentials.
 *  Flowable's REST API checks Basic Auth against the configured
 *  IdentityService, so 200 = correct password, 401 = wrong — there's no
 *  dedicated "verify password" endpoint, so this is the standard trick. */
async function verifyUserPassword(userId, password) {
  const authHeader = 'Basic ' + Buffer.from(`${userId}:${password}`).toString('base64');
  try {
    await axios.get(`${FLOWABLE_BASE}/identity/users/${userId}`, {
      headers: { Authorization: authHeader },
      timeout: 15000,
    });
    return true;
  } catch (err) {
    if (err.response?.status === 401) return false;
    throw err;
  }
}

/** Group ids a user belongs to, e.g. ['engineer']. */
async function getUserGroups(userId) {
  const data = await flowableRequest(
    'GET',
    '/identity/groups',
    null,
    { member: userId }
  );

  return (data.data || []).map(g => g.id);
}
/** All users in a group — used to populate the Zone Manager's assignment
 *  dropdown from the 'engineer' group. */
async function getGroupMembers(groupId) {
  const data = await flowableRequest('GET', '/identity/users', null, { memberOfGroup: groupId });
  return (data.data || []).map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email }));
}


/** True if a runtime process instance with this id still exists (it will,
 *  even for "CLOSED" tickets, since status routes never call completeTask). */
async function processInstanceExists(id) {
  try {
    await flowableRequest('GET', `/runtime/process-instances/${id}`);
    return true;
  } catch (err) {
    if (err.response?.status === 404) return false;
    throw err;
  }
}


/** Finds the process instance whose `ticketNumber` variable matches the
 *  given short id (e.g. 42) — used to resolve a follow-up email's
 *  "(#42)" subject tag back to the right ticket. Checks running instances
 *  first (cheap, no history query), then falls back to historic instances
 *  for tickets that have since been closed. Scans client-side rather than
 *  relying on Flowable's variableValueEquals filtering, for the same
 *  reason findTicketByMessageId does — see the note above it. */
async function getInstanceIdByTicketNumber(ticketNumber) {
  const wanted = String(ticketNumber);

  const running = await getRuntimeInstances('emailTicketWorkflow');
  for (const inst of running) {
    const vars = {};
    for (const v of inst.variables || []) vars[v.name] = v.value;
    if (String(vars.ticketNumber) === wanted) return inst.id;
  }

  const historic = await getHistoricInstances('emailTicketWorkflow');
  for (const inst of historic) {
    const vars = {};
    for (const v of inst.variables || []) vars[v.name] = v.value;
    if (String(vars.ticketNumber) === wanted) return inst.id;
  }

  return null;
}

/** Scans running email/call tickets for one whose threadMessageIds list
 *  contains any of the given message-ids. Used both to find which ticket a
 *  reply belongs to, and to detect "we've already processed this exact
 *  message" so re-running ingest can't double-append a follow-up. */
async function findTicketByMessageId(candidateIds) {
  if (!candidateIds.length) return null;
  const [emailRunning, callRunning] = await Promise.all([
    getRuntimeInstances('emailTicketWorkflow'),
    getRuntimeInstances('callTicketWorkflow'),
  ]);
  for (const inst of [...emailRunning, ...callRunning]) {
    const vars = {};
    for (const v of inst.variables || []) vars[v.name] = v.value;
    let thread = [];
    try {
      thread = JSON.parse(vars.threadMessageIds || '[]');
    } catch {
      thread = [];
    }
    if (thread.some((id) => candidateIds.includes(id))) return inst.id;
  }
  return null;
}

/** Appends a message-id to a ticket's thread, so future replies (including
 *  reply-to-a-reply, where In-Reply-To points at an intermediate message
 *  rather than the original) can still be matched back to this ticket. */
async function appendThreadMessageId(processInstanceId, messageId) {
  const vars = await getProcessVariables(processInstanceId);
  const existing = vars.find((v) => v.name === 'threadMessageIds');
  let list = [];
  if (existing?.value) {
    try {
      list = JSON.parse(String(existing.value));
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
  }
  if (!list.includes(messageId)) list.push(messageId);
  await saveProcessVariable(processInstanceId, 'threadMessageIds', JSON.stringify(list));
  return list;
}
module.exports = {
  FLOWABLE_BASE,
  FLOWABLE_AUTH,
  FLOWABLE_USER,
  FLOWABLE_PASS,
  flowableRequest,
  startTicketProcess,
  getTask,
  claimTask,
  completeTask,
  getProcessVariables,
  saveProcessVariable,
  appendComment,
  getActiveTaskForInstance,
  getRuntimeInstances,
  getHistoricInstances,
  getStatusHistory,
  getRuntimeInstanceByBusinessKey,
  getHistoricInstanceByBusinessKey,
  findUserByEmail,
  verifyUserPassword,
  getUserGroups,
  getGroupMembers,
  appendThreadMessageId,
  findTicketByMessageId,
  processInstanceExists,
  setCommentVisibility,
  getInstanceIdByTicketNumber,  
};