require('dotenv').config();
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const { saveBuffer, isBlocked, INBOUND_MAX_BYTES } = require('./attachments');
const ticketsRepo = require('./ticketsRepo');
const usersRepo = require('./usersRepo');
const { startTicketProcess, saveProcessVariable } = require('./flowableClient');
const { extractFromEmail } = require('./nlpExtract');
const { extractReplyText } = require('./replyExtract');
const { sendAcknowledgementEmail } = require('./emailService');
const { MAILBOXES, ownAddresses } = require('./mailboxes');

function imapConfigFor(mailbox) {
  return {
    imap: {
      user: mailbox.email,
      password: mailbox.password,
      host: process.env.IMAP_HOST,
      port: Number(process.env.IMAP_PORT),
      tls: true,
      authTimeout: 15000,
      tlsOptions: { rejectUnauthorized: false },
    },
  };
}

// Only look at mail from the last N days. Older mail was already handled.
const LOOKBACK_DAYS = Number(process.env.INGEST_LOOKBACK_DAYS) || 3;

async function alreadyTicketed(messageId) {
  const existing = await ticketsRepo.getTicketByBusinessKey(messageId);
  return !!existing;
}

function extractTicketIdFromSubject(subject) {
  if (!subject) return null;
  // New format: [PS-775]. Old format: (#775), kept so replies to earlier mails still match.
  const m = subject.match(/\bPS-\s*(\d+)\b/i) || subject.match(/\(#\s*(\d+)\s*\)/);
  return m ? m[1] : null;
}

/** Bounces, delivery reports and our own outgoing mail are not customer mail. */
function isNotCustomerMail(parsed) {
  const fromAddress = (parsed.from?.value?.[0]?.address || '').toLowerCase();
  const subj = (parsed.subject || '').trim();

  // Any of OUR mailboxes (so zone mailboxes never ticket each other's mail).
  if (ownAddresses().has(fromAddress)) return 'own-mail';
  if (/^\[Internal\]/i.test(subj)) return 'own-mail';
  if (/^(mailer-daemon|postmaster)@/i.test(fromAddress)) return 'bounce';
  if (/^(failure notice|undeliverable|delivery status notification|mail delivery (failed|subsystem)|returned mail)/i.test(subj)) {
    return 'bounce';
  }
  const autoSubmitted = String(parsed.headers?.get('auto-submitted') || '');
  const contentType = String(parsed.headers?.get('content-type')?.value || '');
  if (/auto-(generated|replied)/i.test(autoSubmitted) || /multipart\/report/i.test(contentType)) return 'bounce';
  return null;
}

const REPLY_PREFIX = /^\s*((re|fwd?|fw|aw|sv)\s*:\s*)+/i;
const isReplySubject = (s) => /^\s*(re|fwd?|fw|aw|sv)\s*:/i.test(s || '');
const normalizeSubject = (s) => String(s || '').replace(REPLY_PREFIX, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Resolves an inbound mail to an existing ticket, if it's a follow-up.
 *  Works across all mailboxes, so a reply sent to a different zone mailbox
 *  than the original still lands on the right ticket. */
async function resolveExistingTicket(parsed) {
  const senderEmail = (parsed.from?.value?.[0]?.address || '').toLowerCase();

  // 1) PS-123 (or old "(#123)") in the subject
  const subjectNumber = extractTicketIdFromSubject(parsed.subject);
  if (subjectNumber) {
    const instanceId = await ticketsRepo.getInstanceIdByTicketNumber(subjectNumber);
    if (instanceId) return instanceId;
  }

  // 2) Thread headers: replies to our emails OR to the customer's own original mail
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

  // 3) Subject edited and headers stripped, but our PS-123 is still quoted in the body.
  const quoted = (parsed.text || '').match(/\bPS-(\d{1,9})\b/i);
  if (quoted && senderEmail) {
    const t = await ticketsRepo.getTicketByNumber(Number(quoted[1]));
    if (t && (t.customerEmail || '').toLowerCase() === senderEmail) return t.processInstanceId;
  }

  // 4) A "Re:" mail, same sender, same subject as a recent ticket
  if (isReplySubject(parsed.subject) && senderEmail) {
    const matched = await ticketsRepo.findOpenTicketBySenderAndSubject(senderEmail, normalizeSubject(parsed.subject));
    if (matched) return matched;
  }

  return null; // genuinely new mail
}

/** Stores the customer's attachments. Small inline images (signature logos,
 *  tracking pixels) and executables are skipped. */
async function saveInboundAttachments(parsed, processInstanceId, { commentId = null, messageId }) {
  let saved = 0;
  for (const a of parsed.attachments || []) {
    try {
      const buf = a.content;
      if (!buf || !buf.length) continue;
      const ext = (a.contentType || '').split('/')[1] || 'bin';
      const name = String(a.filename || `attachment.${ext}`).slice(0, 200);

      const inline = a.related || (a.contentDisposition === 'inline' && a.cid);
      if (inline && buf.length < 30 * 1024) continue;
      if (isBlocked(name)) { console.warn(`[mailIngest] skipped blocked attachment "${name}"`); continue; }
      if (buf.length > INBOUND_MAX_BYTES) { console.warn(`[mailIngest] skipped oversized attachment "${name}"`); continue; }

      const rel = await saveBuffer(processInstanceId, name, buf);
      await ticketsRepo.addAttachment(processInstanceId, {
        filename: name,
        contentType: a.contentType,
        sizeBytes: buf.length,
        storagePath: rel,
        sourceMessageId: messageId,
        commentId,
        origin: 'customer',
      });
      saved++;
    } catch (err) {
      console.warn('[mailIngest] could not save an attachment:', err.message);
    }
  }
  if (saved) console.log(`[mailIngest] saved ${saved} attachment(s) for ${processInstanceId}`);
  return saved;
}
/** `mailbox` is where the mail arrived; `zoneId` is that mailbox's zone (or null). */
async function processMessage(connection, message, mailbox, zoneId) {
  const all = message.parts.find((p) => p.which === '');
  const parsed = await simpleParser(all.body);
  const uid = message.attributes.uid;
  const markSeen = () => connection.addFlags(uid, '\\Seen');

  const messageId = parsed.messageId || `${mailbox.key}-${uid}@no-message-id`;

  // 1) Cheapest checks first: no database, no AI.
  const notCustomer = isNotCustomerMail(parsed);
  if (notCustomer) {
    await markSeen();
    return { skipped: true, reason: notCustomer, messageId };
  }

  // 2) Already handled (a ticket, or a reply already appended): mark read and stop.
  if (await alreadyTicketed(messageId) || (await ticketsRepo.findTicketIdByMessageId([messageId]))) {
    await markSeen();
    return { skipped: true, reason: 'duplicate', messageId };
  }

  // 3) Follow-up on an existing ticket: append as a comment.
  const existingTicketId = await resolveExistingTicket(parsed);

  if (existingTicketId) {
    const fromName = parsed.from?.value?.[0]?.name || parsed.from?.text || 'Customer';
       const replyText =
      (extractReplyText(parsed) || parsed.text || '').trim() ||
      ((parsed.attachments || []).length ? '(sent an attachment)' : '(no text in reply)');

    const comment = await ticketsRepo.addComment(existingTicketId, {
      authorId: null,
      authorName: fromName,
      role: 'customer',
      text: replyText,
      timestamp: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
    });
    await saveInboundAttachments(parsed, existingTicketId, { commentId: comment.id, messageId });
    await ticketsRepo.addThreadMessageId(existingTicketId, messageId);

    // A customer reply on a finished ticket reopens it, so agents notice it.
    try {
      const existing = await ticketsRepo.getTicketByProcessInstanceId(existingTicketId);
      if (existing && (existing.ticketStatus === 'RESOLVED' || existing.ticketStatus === 'CLOSED')) {
        await ticketsRepo.updateTicketStatus(existingTicketId, 'OPEN', 'customer-reply');
        await saveProcessVariable(existingTicketId, 'ticketStatus', 'OPEN');
        console.log(`[mailIngest] ticket ${existingTicketId} reopened by customer reply`);
      }
    } catch (err) {
      console.warn('[mailIngest] could not reopen ticket:', err.message);
    }

    await markSeen();
    console.log(`[mailIngest] follow-up appended to ticket ${existingTicketId} (via ${mailbox.email})`);
    return { skipped: false, followUp: true, ticketId: existingTicketId, messageId };
  }

  // 4) New ticket.
  const t0 = Date.now();
  const fields = await extractFromEmail({
    fromHeader: parsed.from?.text,
    subjectHeader: parsed.subject,
    rawBody: parsed.text || parsed.html || '',
    receivedAt: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
  });

  if (fields.skip) {
    console.log(`[mailIngest] skipping non-customer mail (${fields.reason}): "${parsed.subject}"`);
    await markSeen();
    return { skipped: true, reason: fields.reason, messageId };
  }

  const ticketNumber = await ticketsRepo.getNextTicketNumber();

  const variables = [
    { name: 'subject', value: fields.subject },
    { name: 'ticketStatus', value: 'OPEN' },
    { name: 'ticketNumber', value: String(ticketNumber) },
  ];

  const instance = await startTicketProcess(variables, messageId);

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
    zoneId, // the zone of the mailbox this mail arrived at (null for the general mailbox)
  });
  await ticketsRepo.addThreadMessageId(instance.id, messageId);
  await saveInboundAttachments(parsed, instance.id, { commentId: null, messageId });
  // Acknowledge from the SAME mailbox the customer wrote to.
  const ticketUrl = `${process.env.FRONTEND_BASE || 'http://localhost:5174'}/track/${instance.id}`;
  let info;
  try {
    info = await sendAcknowledgementEmail({
      to: fields.customerEmail,
      customerName: fields.customerName,
      subject: fields.subject,
      ticketId: ticketNumber,
      ticketUrl,
      inReplyTo: messageId,
      mailbox,
    });
    console.log(`[mailIngest] ✅ acknowledgement sent for PS-${ticketNumber} to ${fields.customerEmail} from ${mailbox.email}`);
    await ticketsRepo.logNotification(instance.id, {
      type: 'ACKNOWLEDGEMENT',
      toEmail: fields.customerEmail,
      messageId: info?.messageId,
      success: true,
    });
  } catch (err) {
    console.error(`[mailIngest] ❌ acknowledgement FAILED for PS-${ticketNumber} to ${fields.customerEmail}:`, err);
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

  await markSeen();
  console.log(`[mailIngest] PS-${ticketNumber} created in ${Date.now() - t0} ms (${mailbox.zoneName || 'no zone'}, ${mailbox.email})`);

  return {
    skipped: false,
    messageId,
    processInstanceId: instance.id,
    ticketNumber,
    subject: fields.subject,
  };
}

let running = false;
const handledUids = new Set(); // "<mailbox>:<uid>" already dealt with in this server session

/** Polls ONE mailbox. */
async function ingestMailbox(mailbox, zones) {
  const zoneId = mailbox.zoneName ? zones.find((z) => z.name === mailbox.zoneName)?.id ?? null : null;
  if (mailbox.zoneName && zoneId == null) {
    console.warn(`[mailIngest] no zone named "${mailbox.zoneName}" in the zones table; tickets from ${mailbox.email} will be unrouted`);
  }

  const started = Date.now();
  const connection = await imaps.connect(imapConfigFor(mailbox));
  try {
    await connection.openBox('INBOX');

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    // Phase 1: headers only (tiny), so deciding what is new is cheap.
    const headers = await connection.search([['SINCE', since]], {
      bodies: ['HEADER.FIELDS (MESSAGE-ID)'],
      markSeen: false,
    });

    const items = headers
      .map((m) => {
        const uid = m.attributes.uid;
        const part = m.parts.find((p) => String(p.which).toUpperCase().startsWith('HEADER'));
        const messageId = part?.body?.['message-id']?.[0] || `${mailbox.key}-${uid}@no-message-id`;
        return { uid, messageId, key: `${mailbox.key}:${uid}` };
      })
      .filter((i) => !handledUids.has(i.key))
      .sort((a, b) => a.uid - b.uid);

    const known = await ticketsRepo.getKnownMessageIds(items.map((i) => i.messageId));
    items.forEach((i) => {
      if (known.has(i.messageId)) handledUids.add(i.key);
    });
    const fresh = items.filter((i) => !known.has(i.messageId));

    // Phase 2: download full bodies only for mails we haven't seen before.
    const results = [];
    for (const item of fresh) {
      try {
        const [message] = await connection.search([['UID', String(item.uid)]], {
          bodies: [''],
          markSeen: false,
          struct: true,
        });
        if (!message) continue;
        const result = await processMessage(connection, message, mailbox, zoneId);
        handledUids.add(item.key);
        console.log(
          `[mailIngest] ${mailbox.key} uid ${item.uid} → ${result.reason || (result.followUp ? 'follow-up appended' : result.ticketNumber ? 'PS-' + result.ticketNumber + ' created' : 'processed')}`
        );
        results.push(result);
      } catch (err) {
        console.error(`[mailIngest] processMessage failed (${mailbox.email}):`, err);
        results.push({ error: err.message, uid: item.uid });
      }
    }

    const created = results.filter((r) => r && !r.skipped && !r.error && !r.followUp).length;
    console.log(
      `[mailIngest] ${mailbox.key}: ${Date.now() - started} ms, ${headers.length} recent, ${fresh.length} new, ${created} ticket(s) created`
    );
    return results;
  } finally {
    try { await connection.end(); } catch { /* ignore */ }
  }
}

async function runIngestOnce() {
  if (!MAILBOXES.length) {
    throw new Error('No mailboxes configured: set EMAIL/EMAIL_APP_PASSWORD and/or MAILBOX_<ZONE>_EMAIL/PASSWORD in .env');
  }

  if (running) {
    console.log('[mailIngest] previous run still going, skipping this cycle');
    return [];
  }
  running = true;

  try {
    const zones = await usersRepo.listZones();
    const all = [];
    // One mailbox failing (wrong password, etc.) must not stop the others.
    for (const mailbox of MAILBOXES) {
      try {
        all.push(...(await ingestMailbox(mailbox, zones)));
      } catch (err) {
        console.error(`[mailIngest] ❌ mailbox ${mailbox.email} failed:`, err.message);
        all.push({ error: err.message, mailbox: mailbox.email });
      }
    }
    return all;
  } finally {
    running = false;
  }
}

module.exports = { runIngestOnce, saveInboundAttachments };