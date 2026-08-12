// /**
//  * Polls the Gmail inbox over IMAP (imap-simple + mailparser), runs each
//  * unread mail through the hybrid NLP+Claude extractor, and starts one
//  * emailTicketWorkflow process instance per mail.
//  *
//  * Auth: Gmail requires an **App Password** for IMAP (not the normal Gmail
//  * password) — the account needs 2-Step Verification on, then generate one
//  * at https://myaccount.google.com/apppasswords and put it in EMAIL_PASS.
//  * (Using the Gmail API with OAuth instead of IMAP is an option too — see
//  * the note at the bottom of this file — but IMAP + app password is the
//  * fastest path to a working pipeline.)
//  *
//  * De-duplication: Gmail's Message-Id header is used as the Flowable
//  * process businessKey, so re-running ingest never creates a duplicate
//  * ticket for the same mail, even if the "mark as read" step fails.
//  */
// require('dotenv').config();
// const { getNextTicketNumber } = require('./ticketCounter');
// const imaps = require('imap-simple');
// const { simpleParser } = require('mailparser');
// const {
//   startTicketProcess,
//   getRuntimeInstanceByBusinessKey,
//   getHistoricInstanceByBusinessKey,
//   processInstanceExists,
//   findTicketByMessageId,
//     getInstanceIdByTicketNumber,   
//   appendThreadMessageId,
//   appendComment,
// } = require('./flowableClient');
// const { extractFromEmail } = require('./nlpExtract');
// const { sendAcknowledgementEmail } = require("./emailService");
// const { extractReplyText } = require('./replyExtract');
// const imapConfig = {
//   imap: {
//     user: process.env.EMAIL,
//     password: process.env.EMAIL_APP_PASSWORD,
//     host: process.env.IMAP_HOST,
//     port: Number(process.env.IMAP_PORT),
//     tls: true,
//     authTimeout: 15000,
//     tlsOptions: { rejectUnauthorized: false },
//   },
// };

// async function alreadyTicketed(messageId) {
//   const running = await getRuntimeInstanceByBusinessKey('emailTicketWorkflow', messageId);
//   if (running) return true;
//   const historic = await getHistoricInstanceByBusinessKey('emailTicketWorkflow', messageId);
//   return !!historic;
// }


// function extractTicketIdFromSubject(subject) {
//   if (!subject) return null;
//   const m = subject.match(/\(#([a-zA-Z0-9-]+)\)/);
//   return m ? m[1] : null;
// }

// /** Resolves an inbound mail to an existing ticket, if it's a follow-up.
//  *  Tries the ticket id embedded in the subject first (survives across
//  *  mail clients and reply chains), then falls back to email threading
//  *  headers for cases where the subject got edited or stripped. */
// async function resolveExistingTicket(parsed) {
//   const subjectTicketNumber = extractTicketIdFromSubject(parsed.subject);
//   if (subjectTicketNumber) {
//     const instanceId = await getInstanceIdByTicketNumber(subjectTicketNumber);
//     if (instanceId) return instanceId;
//   }

//   const candidateIds = [];
//   if (parsed.inReplyTo) candidateIds.push(parsed.inReplyTo);
//   if (parsed.references) {
//     const refs = Array.isArray(parsed.references) ? parsed.references : [parsed.references];
//     candidateIds.push(...refs);
//   }
//   if (candidateIds.length) {
//     const matched = await findTicketByMessageId(candidateIds);
//     if (matched) return matched;
//   }

//   return null;
// }

// async function processMessage(connection, message) {
  
//   const all = message.parts.find((p) => p.which === '');
//   const parsed = await simpleParser(all.body);

//   const messageId = parsed.messageId || `${message.attributes.uid}@no-message-id`;

//   // Covers both "we already created a ticket for this exact email" and
//   // "we already appended this exact reply to a ticket's thread".
//   if (await alreadyTicketed(messageId)) return { skipped: true, messageId };
//   if (await findTicketByMessageId([messageId])) return { skipped: true, messageId };

//   const existingTicketId = await resolveExistingTicket(parsed);

//   if (existingTicketId) {
//     // Follow-up on an existing ticket: append as a comment, don't create
//     // a new process instance. Status is left exactly as it was.
//     const fromName = parsed.from?.value?.[0]?.name || parsed.from?.text || 'Customer';
  

// const replyText = extractReplyText(parsed);
//     await appendComment(existingTicketId, {
//       authorId: null,
//       authorName: fromName,
//       role: 'customer',
//       text: replyText,
//       timestamp: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
//     });
//     await appendThreadMessageId(existingTicketId, messageId);

//     await connection.addFlags(message.attributes.uid, '\\Seen');
//     console.log(`Follow-up appended to ticket ${existingTicketId}`);

//     return { skipped: false, followUp: true, ticketId: existingTicketId, messageId };
//   }

//   // ── Not a follow-up — existing "create a new ticket" flow below ──────
//   const fields = await extractFromEmail({
//     fromHeader: parsed.from?.text,
//     subjectHeader: parsed.subject,
//     rawBody: parsed.text || parsed.html || '',
//     receivedAt: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
//   });

//  const ticketNumber = getNextTicketNumber();

// const variables = [
//   { name: 'subject', value: fields.subject },
//   { name: 'description', value: fields.description },
//   { name: 'customerName', value: fields.customerName },
//   { name: 'customerEmail', value: fields.customerEmail },
//   { name: 'productOrCategory', value: fields.productOrCategory },
//   { name: 'urgency', value: fields.urgency },
//   { name: 'sentiment', value: fields.sentiment },
//   { name: 'receivedAt', value: fields.receivedAt },
//   { name: 'sourceMessageId', value: messageId },
//   { name: 'threadMessageIds', value: JSON.stringify([messageId]) },
//   { name: 'ticketStatus', value: 'OPEN' },
//   { name: 'comments', value: '[]' },
//    { name: 'ticketNumber', value: String(ticketNumber) },
// ];

// const instance = await startTicketProcess(variables, messageId);

// const ticketUrl = `${process.env.FRONTEND_BASE || 'http://localhost:5173'}/track/${instance.id}`;

// const info = await sendAcknowledgementEmail({
//     to: fields.customerEmail,
//     customerName: fields.customerName,
//     subject: fields.subject,
//     ticketId: ticketNumber,       // ← show the short number, not instance.id
//     ticketUrl,
//     inReplyTo: messageId,
// });
// if (info?.messageId) {
//   await appendThreadMessageId(instance.id, info.messageId);
// }
// // Mark mail as read only after everything succeeds
// await connection.addFlags(message.attributes.uid, '\\Seen');

// return {
//     skipped: false,
//     messageId,
//     processInstanceId: instance.id,
//     subject: fields.subject
// };
// }

// async function runIngestOnce() {
// if (!process.env.EMAIL || !process.env.EMAIL_APP_PASSWORD) {
//     throw new Error('EMAIL and EMAIL_APP_PASSWORD must be set in .env');

// }
//   if (!process.env.ANTHROPIC_API_KEY) {
//     throw new Error('ANTHROPIC_API_KEY must be set in .env');
//   }

//   const connection = await imaps.connect(imapConfig);
//   await connection.openBox('INBOX');

//   const searchCriteria = ['ALL'];
//   const fetchOptions = { bodies: [''], markSeen: false, struct: true };
//   const messages = await connection.search(searchCriteria, fetchOptions);

//   const results = [];
//   for (const message of messages) {
//     try {
//       results.push(await processMessage(connection, message));
//     } catch (err) {
//       results.push({ error: err.message, uid: message.attributes.uid });
//     }
//   }

//   await connection.end();
//   return results;
// }

// module.exports = { runIngestOnce };

// /**
//  * Gmail API (OAuth) alternative, if you'd rather not use an app password:
//  *   1. Enable the Gmail API in Google Cloud Console for the project owning
//  *      urcsupportotp@gmail.com, create OAuth credentials, get a refresh
//  *      token (one-time consent flow).
//  *   2. Replace this file's imap-simple calls with googleapis' gmail.users
//  *      .messages.list({ q: 'is:unread' }) + .get() to fetch bodies, and
//  *      gmail.users.messages.modify() to remove the UNREAD label instead of
//  *      connection.addFlags. Everything downstream (extractFromEmail,
//  *      startTicketProcess, dedupe by Message-Id) stays identical.
//  *   IMAP is simpler to stand up first; swap later if you need push
//  *   notifications (Gmail watch()) instead of polling.
//  */


/**
 * Polls the Gmail inbox over IMAP (imap-simple + mailparser), runs each
 * unread mail through the hybrid NLP+Claude extractor, and starts one
 * emailTicketWorkflow process instance per mail.
 *
 * Auth: Gmail requires an **App Password** for IMAP (not the normal Gmail
 * password) — the account needs 2-Step Verification on, then generate one
 * at https://myaccount.google.com/apppasswords and put it in EMAIL_PASS.
 *
 * De-duplication: Gmail's Message-Id header is used as the Flowable
 * process businessKey AND the Postgres tickets.business_key (unique),
 * so re-running ingest never creates a duplicate ticket for the same
 * mail, even if the "mark as read" step fails.
 *
 * Storage split: Flowable still owns workflow (which step, who's the
 * active task assignee). Everything searchable/listable — subject,
 * description, comments, thread — now lives in Postgres via
 * ticketsRepo.js, which is what makes lookups instant instead of
 * looping through every running process instance.
 */
require('dotenv').config();
const ticketsRepo = require('./ticketsRepo');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const { startTicketProcess } = require('./flowableClient');
const { extractFromEmail } = require('./nlpExtract');
const { sendAcknowledgementEmail } = require('./emailService');
const { extractReplyText } = require('./replyExtract');

const imapConfig = {
  imap: {
    user: process.env.EMAIL,
    password: process.env.EMAIL_APP_PASSWORD,
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT),
    tls: true,
    authTimeout: 15000,
    tlsOptions: { rejectUnauthorized: false },
  },
};

async function alreadyTicketed(messageId) {
  const existing = await ticketsRepo.getTicketByBusinessKey(messageId);
  return !!existing;
}

function extractTicketIdFromSubject(subject) {
  if (!subject) return null;
  const m = subject.match(/\(#([a-zA-Z0-9-]+)\)/);
  return m ? m[1] : null;
}

/** Resolves an inbound mail to an existing ticket, if it's a follow-up.
 *  Tries the ticket number embedded in the subject first (survives across
 *  mail clients and reply chains), then falls back to email threading
 *  headers for cases where the subject got edited or stripped. Both
 *  lookups are now indexed Postgres queries instead of scanning Flowable. */
async function resolveExistingTicket(parsed) {
  const subjectTicketNumber = extractTicketIdFromSubject(parsed.subject);
  if (subjectTicketNumber) {
    const instanceId = await ticketsRepo.getInstanceIdByTicketNumber(subjectTicketNumber);
    if (instanceId) return instanceId;
  }

  const candidateIds = [];
  if (parsed.inReplyTo) candidateIds.push(parsed.inReplyTo);
  if (parsed.references) {
    const refs = Array.isArray(parsed.references) ? parsed.references : [parsed.references];
    candidateIds.push(...refs);
  }
  if (candidateIds.length) {
    const matched = await ticketsRepo.findTicketIdByMessageId(candidateIds);
    if (matched) return matched;
  }

  return null;
}

async function processMessage(connection, message) {
  const all = message.parts.find((p) => p.which === '');
  const parsed = await simpleParser(all.body);

  const messageId = parsed.messageId || `${message.attributes.uid}@no-message-id`;

  // Covers both "we already created a ticket for this exact email" and
  // "we already appended this exact reply to a ticket's thread".
  if (await alreadyTicketed(messageId)) return { skipped: true, messageId };
  if (await ticketsRepo.findTicketIdByMessageId([messageId])) return { skipped: true, messageId };

  const existingTicketId = await resolveExistingTicket(parsed);

  if (existingTicketId) {
    // Follow-up on an existing ticket: append as a comment, don't create
    // a new process instance. Status is left exactly as it was.
    const fromName = parsed.from?.value?.[0]?.name || parsed.from?.text || 'Customer';
    const replyText = extractReplyText(parsed);

    await ticketsRepo.addComment(existingTicketId, {
      authorId: null,
      authorName: fromName,
      role: 'customer',
      text: replyText,
      timestamp: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
    });
    await ticketsRepo.addThreadMessageId(existingTicketId, messageId);

    await connection.addFlags(message.attributes.uid, '\\Seen');
    console.log(`Follow-up appended to ticket ${existingTicketId}`);

    return { skipped: false, followUp: true, ticketId: existingTicketId, messageId };
  }

  // ── Not a follow-up — create a new ticket ────────────────────────────
  const fields = await extractFromEmail({
    fromHeader: parsed.from?.text,
    subjectHeader: parsed.subject,
    rawBody: parsed.text || parsed.html || '',
    receivedAt: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
  });

  // Reserve the ticket number before starting the process, since it's
  // shown to the customer in the acknowledgement email/subject tag.
  const ticketNumber = await ticketsRepo.getNextTicketNumber();

  // Flowable variables — kept minimal, since Postgres is now the source
  // of truth for ticket content. ticketStatus/ticketNumber stay here too
  // because the BPMN gateway and task list still read them.
  const variables = [
    { name: 'subject', value: fields.subject },
    { name: 'ticketStatus', value: 'OPEN' },
    { name: 'ticketNumber', value: String(ticketNumber) },
  ];

  const instance = await startTicketProcess(variables, messageId);

  // Now that we have the process_instance_id, write the full ticket row.
  await ticketsRepo.createTicket({
    ticketNumber,
    processInstanceId: instance.id,
    source: 'email',
    businessKey: messageId,
    subject: fields.subject,
    description: fields.description,
    customerName: fields.customerName,
    customerEmail: fields.customerEmail,
    productOrCategory: fields.productOrCategory,
    urgency: fields.urgency,
    sentiment: fields.sentiment,
    receivedAt: fields.receivedAt,
  });
  await ticketsRepo.addThreadMessageId(instance.id, messageId);

  const ticketUrl = `${process.env.FRONTEND_BASE || 'http://localhost:5173'}/track/${instance.id}`;

  let info;
  try {
    info = await sendAcknowledgementEmail({
      to: fields.customerEmail,
      customerName: fields.customerName,
      subject: fields.subject,
      ticketId: ticketNumber,
      ticketUrl,
      inReplyTo: messageId,
    });
    await ticketsRepo.logNotification(instance.id, {
      type: 'ACKNOWLEDGEMENT',
      toEmail: fields.customerEmail,
      messageId: info?.messageId,
      success: true,
    });
  } catch (err) {
    await ticketsRepo.logNotification(instance.id, {
      type: 'ACKNOWLEDGEMENT',
      toEmail: fields.customerEmail,
      success: false,
      errorMessage: err.message,
    });
  }

  if (info?.messageId) {
    await ticketsRepo.addThreadMessageId(instance.id, info.messageId);
  }

  // Mark mail as read only after everything succeeds
  await connection.addFlags(message.attributes.uid, '\\Seen');

  return {
    skipped: false,
    messageId,
    processInstanceId: instance.id,
    ticketNumber,
    subject: fields.subject,
  };
}

async function runIngestOnce() {
  if (!process.env.EMAIL || !process.env.EMAIL_APP_PASSWORD) {
    throw new Error('EMAIL and EMAIL_APP_PASSWORD must be set in .env');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY must be set in .env');
  }

  const connection = await imaps.connect(imapConfig);
  await connection.openBox('INBOX');

  const searchCriteria = ['ALL'];
  const fetchOptions = { bodies: [''], markSeen: false, struct: true };
  const messages = await connection.search(searchCriteria, fetchOptions);

  const results = [];
  for (const message of messages) {
    try {
      results.push(await processMessage(connection, message));
    } catch (err) {
      console.error('[mailIngest] processMessage failed:', err);
      results.push({ error: err.message, uid: message.attributes.uid });
    }
  }

  await connection.end();
  return results;
}

module.exports = { runIngestOnce };

/**
 * Gmail API (OAuth) alternative, if you'd rather not use an app password:
 *   1. Enable the Gmail API in Google Cloud Console for the project owning
 *      the support inbox, create OAuth credentials, get a refresh token
 *      (one-time consent flow).
 *   2. Replace this file's imap-simple calls with googleapis' gmail.users
 *      .messages.list({ q: 'is:unread' }) + .get() to fetch bodies, and
 *      gmail.users.messages.modify() to remove the UNREAD label instead of
 *      connection.addFlags. Everything downstream (extractFromEmail,
 *      startTicketProcess, ticketsRepo, dedupe by Message-Id) stays
 *      identical.
 *   IMAP is simpler to stand up first; swap later if you need push
 *   notifications (Gmail watch()) instead of polling.
 */