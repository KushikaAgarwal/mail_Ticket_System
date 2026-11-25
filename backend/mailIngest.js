require('dotenv').config();
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const pLimit = require('p-limit');

const ticketsRepo = require('./ticketsRepo');
const usersRepo = require('./usersRepo');
const { startTicketProcess } = require('./flowableClient');
const { extractFromEmail } = require('./nlpExtract');
const { extractReplyText } = require('./replyExtract');
const { sendAcknowledgementEmail } = require('./emailService');

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
  // allow stray whitespace some mail clients introduce around the
  // parens when folding/decoding long or encoded subject headers
  const m = subject.match(/\(#\s*(\d+)\s*\)/);
  return m ? m[1] : null;
}

/** Resolves an inbound mail to an existing ticket, if it's a follow-up.
 *  Tries the ticket number embedded in the subject first, then the
 *  reply-thread's own recorded message-ids, then falls back to matching
 *  against the ORIGINAL customer message-id (stored as business_key). */
async function resolveExistingTicket(parsed) {
  const subjectTicketNumber = extractTicketIdFromSubject(parsed.subject);

  if (subjectTicketNumber) {
    const instanceId = await ticketsRepo.getInstanceIdByTicketNumber(subjectTicketNumber);
    if (instanceId) return instanceId;
    console.warn(
      `[mailIngest] subject had ticket #${subjectTicketNumber} but no matching ticket in DB — falling back to header match. subject="${parsed.subject}"`
    );
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

    const byBusinessKey = await ticketsRepo.getTicketByBusinessKeyIn(candidateIds);
    if (byBusinessKey) return byBusinessKey.processInstanceId;
  }

  console.warn(
    `[mailIngest] could not resolve existing ticket for reply — subject="${parsed.subject}", inReplyTo="${parsed.inReplyTo}", references=${JSON.stringify(parsed.references)} — will be treated as a NEW ticket`
  );
  return null;
}

async function processMessage(connection, message) {
  const all = message.parts.find((p) => p.which === '');
  const parsed = await simpleParser(all.body);

  const messageId = parsed.messageId || `${message.attributes.uid}@no-message-id`;
// Never turn our own outgoing mail (old "[Internal]" alerts, etc.) into tickets.
  const fromAddress = (parsed.from?.value?.[0]?.address || '').toLowerCase();
  const ownAddress = (process.env.EMAIL || '').toLowerCase();
  if ((ownAddress && fromAddress === ownAddress) || /^\s*\[Internal\]/i.test(parsed.subject || '')) {
    await connection.addFlags(message.attributes.uid, '\\Seen');
    return { skipped: true, reason: 'own-mail', messageId };
  }
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

  if (fields.skip) {
    console.log(`[mailIngest] skipping non-customer mail (${fields.reason}): "${parsed.subject}"`);
    await connection.addFlags(message.attributes.uid, '\\Seen');
    return { skipped: true, reason: fields.reason, messageId };
  }

  // Reserve the ticket number before starting the process, since it's
  // shown to the customer in the acknowledgement email/subject tag.
  const ticketNumber = await ticketsRepo.getNextTicketNumber();

  // Flowable variables — kept minimal, since Postgres is the source
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

  

  // Acknowledge the customer
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

  const connection = await imaps.connect(imapConfig);
  await connection.openBox('INBOX');

  const searchCriteria = ['ALL'];
  const fetchOptions = { bodies: [''], markSeen: false, struct: true };
  const messages = await connection.search(searchCriteria, fetchOptions);

  const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY) || 8;
  const limit = pLimit(CONCURRENCY);

  const results = await Promise.all(
    messages.map((message) =>
      limit(async () => {
        try {
          return await processMessage(connection, message);
        } catch (err) {
          console.error('[mailIngest] processMessage failed:', err);
          return { error: err.message, uid: message.attributes.uid };
        }
      })
    )
  );

  await connection.end();
  return results;
}

module.exports = { runIngestOnce };