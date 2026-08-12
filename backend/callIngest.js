// /**
//  * Creates a support ticket from an inbound-call event, using its own
//  * `callTicketWorkflow` BPMN process (bpmn/callTicketWorkflow.bpmn20.xml) —
//  * a separate process definition from email's emailTicketWorkflow, so the
//  * two channels can evolve independently.
//  *
//  * De-duplication mirrors mailIngest.js: instead of a Gmail Message-Id, the
//  * SIP call's callId is used as the Flowable businessKey. If the same call
//  * somehow triggers this twice (e.g. a retried webhook), no duplicate ticket
//  * is created — this also backs BR-23 ("look up an existing open ticket").
//  */
// const {
//   startTicketProcess,
//   getRuntimeInstanceByBusinessKey,
//   getHistoricInstanceByBusinessKey,
// } = require('./flowableClient');

// const PROCESS_KEY = 'callTicketWorkflow';

// async function alreadyTicketed(callId) {
//   const running = await getRuntimeInstanceByBusinessKey(PROCESS_KEY, callId);
//   if (running) return running;
//   const historic = await getHistoricInstanceByBusinessKey(PROCESS_KEY, callId);
//   return historic || null;
// }

// /**
//  * @param {object} params
//  * @param {string} params.callId        SIP call id from the CTI adapter (Flowable businessKey)
//  * @param {string} params.callerNumber  Caller's extension/number (BR-20 screen-pop field)
//  * @param {string} params.agentId       Extension/id of the agent who answered
//  * @param {string} [params.description] Issue description entered by the rep (BR-21)
//  * @param {string} [params.category]    productOrCategory, same field email tickets use
//  * @param {string} [params.urgency]     LOW | MEDIUM | HIGH
//  * @param {string} [params.customerName]
//  * @param {string} [params.customerEmail]
//  * @param {string} [params.callAnsweredAt]     ISO timestamp, from the softphone's answer event
//  * @param {string} [params.callEndedAt]        ISO timestamp, from the softphone's terminated event
//  * @param {number} [params.callDurationSeconds]
//  */
// async function createTicketFromCall({
//   callId,
//   callerNumber,
//   agentId,
//   description,
//   category,
//   urgency,
//   customerName,
//   customerEmail,
//   callAnsweredAt,
//   callEndedAt,
//   callDurationSeconds,
// }) {
//   if (!callId) throw new Error('callId is required');
//   if (!callerNumber) throw new Error('callerNumber is required');

//   const existing = await alreadyTicketed(callId);
//   if (existing) {
//     return { skipped: true, callId, processInstanceId: existing.id };
//   }

//   const nowIso = new Date().toISOString();

//   const variables = [
//     { name: 'subject', value: `Call from ${callerNumber}` },
//     { name: 'description', value: description || '(call ticket — details pending)' },
//     { name: 'customerName', value: customerName || callerNumber },
//     { name: 'customerEmail', value: customerEmail || '' },
//     { name: 'productOrCategory', value: category || 'UNSPECIFIED' },
//     { name: 'urgency', value: urgency || 'MEDIUM' },
//     { name: 'sentiment', value: 'NEUTRAL' },
//     { name: 'receivedAt', value: nowIso },
//     { name: 'ticketStatus', value: 'OPEN' },
//     { name: 'comments', value: '[]' },
//     // Call-specific fields (BR-22: call reference for traceability)
//     { name: 'source', value: 'call' },
//     { name: 'callId', value: callId },
//     { name: 'callerNumber', value: callerNumber },
//     { name: 'agentId', value: agentId || '' },
//     { name: 'callAnsweredAt', value: callAnsweredAt || '' },
//     { name: 'callEndedAt', value: callEndedAt || '' },
//     { name: 'callDurationSeconds', value: String(callDurationSeconds ?? '') },
//   ];

//   const instance = await startTicketProcess(variables, callId, PROCESS_KEY);

//   return {
//     skipped: false,
//     callId,
//     processInstanceId: instance.id,
//     subject: `Call from ${callerNumber}`,
//   };
// }

// module.exports = { createTicketFromCall, alreadyTicketed, PROCESS_KEY };

/**
 * Creates a support ticket from an inbound-call event, using its own
 * `callTicketWorkflow` BPMN process (bpmn/callTicketWorkflow.bpmn20.xml) —
 * a separate process definition from email's emailTicketWorkflow, so the
 * two channels can evolve independently.
 *
 * De-duplication mirrors mailIngest.js: instead of a Gmail Message-Id, the
 * SIP call's callId is used as both the Flowable businessKey AND the
 * Postgres tickets.business_key (unique). If the same call somehow
 * triggers this twice (e.g. a retried webhook), no duplicate ticket is
 * created — this also backs BR-23 ("look up an existing open ticket").
 */
const { startTicketProcess } = require('./flowableClient');
const ticketsRepo = require('./ticketsRepo');

const PROCESS_KEY = 'callTicketWorkflow';

async function alreadyTicketed(callId) {
  return ticketsRepo.getTicketByBusinessKey(callId);
}

/**
 * @param {object} params
 * @param {string} params.callId        SIP call id from the CTI adapter (Flowable businessKey)
 * @param {string} params.callerNumber  Caller's extension/number (BR-20 screen-pop field)
 * @param {string} params.agentId       Extension/id of the agent who answered
 * @param {string} [params.description] Issue description entered by the rep (BR-21)
 * @param {string} [params.category]    productOrCategory, same field email tickets use
 * @param {string} [params.urgency]     LOW | MEDIUM | HIGH
 * @param {string} [params.customerName]
 * @param {string} [params.customerEmail]
 * @param {string} [params.callAnsweredAt]     ISO timestamp, from the softphone's answer event
 * @param {string} [params.callEndedAt]        ISO timestamp, from the softphone's terminated event
 * @param {number} [params.callDurationSeconds]
 */
async function createTicketFromCall({
  callId,
  callerNumber,
  agentId,
  description,
  category,
  urgency,
  customerName,
  customerEmail,
  callAnsweredAt,
  callEndedAt,
  callDurationSeconds,
}) {
  if (!callId) throw new Error('callId is required');
  if (!callerNumber) throw new Error('callerNumber is required');

  const existing = await alreadyTicketed(callId);
  if (existing) {
    return { skipped: true, callId, processInstanceId: existing.processInstanceId };
  }

  const nowIso = new Date().toISOString();
  const subject = `Call from ${callerNumber}`;
  const ticketNumber = await ticketsRepo.getNextTicketNumber();

  // Flowable variables kept minimal — same reasoning as mailIngest.js.
  const variables = [
    { name: 'subject', value: subject },
    { name: 'ticketStatus', value: 'OPEN' },
    { name: 'ticketNumber', value: String(ticketNumber) },
    { name: 'source', value: 'call' },
  ];

  const instance = await startTicketProcess(variables, callId, PROCESS_KEY);

  await ticketsRepo.createTicket({
    ticketNumber,
    processInstanceId: instance.id,
    source: 'call',
    businessKey: callId,
    subject,
    description: description || '(call ticket — details pending)',
    customerName: customerName || callerNumber,
    customerEmail: customerEmail || '',
    productOrCategory: category || 'UNSPECIFIED',
    urgency: urgency || 'MEDIUM',
    sentiment: 'NEUTRAL',
    receivedAt: nowIso,
    callId,
    callerNumber,
    agentId: agentId || '',
    callAnsweredAt: callAnsweredAt || null,
    callEndedAt: callEndedAt || null,
    callDurationSeconds: callDurationSeconds ?? null,
  });

  return {
    skipped: false,
    callId,
    processInstanceId: instance.id,
    ticketNumber,
    subject,
  };
}

module.exports = { createTicketFromCall, alreadyTicketed, PROCESS_KEY };