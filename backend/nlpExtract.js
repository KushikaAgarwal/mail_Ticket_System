/**
 * Turns a raw incoming email into ticket fields.
 * 100% local and free — simple rules, no AI service or API key needed.
 *
 *  1. Skip obvious system mail (bounces, auto-replies, no-reply senders).
 *  2. Clean the body (remove quoted replies and signatures).
 *  3. Fill in the ticket fields from the email itself + keyword rules.
 */

// ── 1. System / automated mail that should never become a ticket ────────
const SYSTEM_SENDER_PATTERNS = [
  /mailer-daemon/i,
  /postmaster/i,
  /no-?reply/i,
  /do-?not-?reply/i,
  /bounce/i,
  /mail-?delivery/i,
];

const SYSTEM_SUBJECT_PATTERNS = [
  /delivery status notification/i,
  /undeliver(ed|able)/i,
  /returned mail/i,
  /mail delivery failed/i,
  /delivery has failed/i,
  /automatic reply/i,
  /auto-?reply/i,
  /out of office/i,
  /^re: \[.*\] support ticket created/i, // our own acknowledgement looping back
];

function isObviousSystemMail({ fromHeader, subjectHeader }) {
  const from = fromHeader || '';
  const subject = subjectHeader || '';
  return (
    SYSTEM_SENDER_PATTERNS.some((p) => p.test(from)) ||
    SYSTEM_SUBJECT_PATTERNS.some((p) => p.test(subject))
  );
}

// ── 2. Body cleanup ─────────────────────────────────────────────────────
function cleanBody(rawText) {
  let text = rawText || '';

  // Drop quoted reply chains and everything after them
  text = text.split(/\r?\nOn .+wrote:\r?\n/i)[0];
  text = text.split(/\r?\n-{2,}\s*Original Message\s*-{2,}/i)[0];

  // Drop quote-marker lines ("> ...")
  text = text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n');

  // Drop signatures
  text = text.split(/\r?\n--\s*\r?\n/)[0];
  text = text.split(/\r?\n(Sent from my|Regards,|Thanks,|Best,|Kind regards,)/i)[0];

  return text.trim().slice(0, 6000);
}

// ── 3. Simple keyword rules (edit these lists to tune the results) ──────
const URGENT_KEYWORDS = ['urgent', 'asap', 'immediately', 'down', 'outage', 'critical', 'not working', 'blocked', 'production'];

const NEGATIVE_WORDS = ['angry', 'worst', 'terrible', 'unacceptable', 'disappointed', 'complaint', 'frustrated', 'fed up', 'ridiculous', 'still not'];
const POSITIVE_WORDS = ['thank', 'thanks', 'great', 'appreciate', 'happy', 'excellent'];

const CATEGORY_RULES = [
  ['Billing',         ['invoice', 'billing', 'payment', 'charged', 'charge']],
  ['Refund',          ['refund', 'money back', 'cancel order']],
  ['Account Access',  ['password', 'login', 'log in', 'sign in', 'locked', 'otp', 'access']],
  ['Technical Issue', ['error', 'bug', 'crash', 'not working', 'down', 'outage', 'failed', 'issue']],
  ['Feature Request', ['feature', 'suggest', 'would be nice', 'request to add']],
];

function localUrgency(text) {
  const lower = text.toLowerCase();
  const hits = URGENT_KEYWORDS.filter((k) => lower.includes(k)).length;
  const bangs = (text.match(/!!+/g) || []).length;
  if (hits >= 2 || bangs > 0) return 'HIGH';
  if (hits === 1) return 'MEDIUM';
  return 'LOW';
}

function guessSentiment(text, urgency) {
  const lower = text.toLowerCase();
  const negative = NEGATIVE_WORDS.some((w) => lower.includes(w));
  if (negative && urgency === 'HIGH') return 'FRUSTRATED';
  if (negative) return 'NEGATIVE';
  if (POSITIVE_WORDS.some((w) => lower.includes(w))) return 'POSITIVE';
  return 'NEUTRAL';
}

function guessCategory(text) {
  const lower = text.toLowerCase();
  for (const [category, words] of CATEGORY_RULES) {
    if (words.some((w) => lower.includes(w))) return category;
  }
  return 'General Inquiry';
}

function cleanSubject(subjectHeader) {
  const s = (subjectHeader || '').replace(/^(\s*(re|fwd?)\s*:\s*)+/i, '').trim();
  return (s || 'New support ticket').slice(0, 120);
}

function parseSender(fromHeader) {
  // "Jane Doe <jane@acme.com>" -> { name: "Jane Doe", email: "jane@acme.com" }
  const match = /^(.*?)\s*<(.+?)>$/.exec((fromHeader || '').trim());
  if (match) return { name: match[1].replace(/"/g, '').trim() || null, email: match[2].trim() };
  const emailOnly = /[^\s<>]+@[^\s<>]+/.exec(fromHeader || '');
  return { name: null, email: emailOnly ? emailOnly[0] : null };
}

// ── Entry point used by mailIngest.js ───────────────────────────────────
/** Returns { skip: true, reason } for mail that shouldn't become a ticket,
 *  otherwise the ticket fields. Kept async so mailIngest.js needs no change
 *  to how it calls this. */
async function extractFromEmail({ fromHeader, subjectHeader, rawBody, receivedAt }) {
  if (isObviousSystemMail({ fromHeader, subjectHeader })) {
    return { skip: true, reason: 'system_generated_mail' };
  }

  const body = cleanBody(rawBody);
  const { name, email } = parseSender(fromHeader);
  const searchText = `${subjectHeader || ''}\n${body}`;
  const urgency = localUrgency(searchText);

  return {
    subject: cleanSubject(subjectHeader),
    description: body.slice(0, 500) || '(no message body)',
    customerName: name || email || 'Unknown',
    customerEmail: email || 'unknown@unknown',
    productOrCategory: guessCategory(searchText),
    urgency,
    sentiment: guessSentiment(searchText, urgency),
    receivedAt: receivedAt || new Date().toISOString(),
  };
}

module.exports = { extractFromEmail };