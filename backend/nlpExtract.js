/**
 * Hybrid extraction pipeline.
 *
 * Layer 1 (local, free, instant) — regex/heuristics:
 *   - strips quoted history ("On ... wrote:"), signatures, disclaimers
 *   - pulls a candidate customer name/email from headers
 *   - cheap keyword-based urgency pre-flag ("urgent", "down", "asap", "!!!")
 *
 * Layer 2 (Claude) — only runs on the CLEANED body, not the raw email, so
 * signatures/quoted threads/HTML cruft never burn tokens. Returns strict
 * JSON so it drops straight into Flowable process variables. We only escalate
 * ambiguous urgency/sentiment calls to Claude; the obvious ones from layer 1
 * are passed through as a hint the model can override if the text disagrees.
 *
 * Model choice: Claude Haiku 4.5 by default (fast/cheap, plenty for
 * structured field extraction on a single email). Long or ambiguous emails
 * (> LONG_EMAIL_CHARS) escalate to Claude Sonnet 5 for better judgement on
 * category/sentiment. Override via EXTRACT_MODEL / EXTRACT_MODEL_ESCALATED.
 */

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL_DEFAULT = process.env.EXTRACT_MODEL || 'claude-haiku-4-5-20251001';
const MODEL_ESCALATED = process.env.EXTRACT_MODEL_ESCALATED || 'claude-sonnet-5';
const LONG_EMAIL_CHARS = 2000;

const URGENT_KEYWORDS = ['urgent', 'asap', 'immediately', 'down', 'outage', 'critical', 'not working', 'blocked', 'production'];

// ── Layer 1: cheap local cleanup ────────────────────────────────────────
function cleanBody(rawText) {
  let text = rawText || '';

  // Drop quoted reply chains ("On <date>, X wrote:" and everything after)
  text = text.split(/\r?\nOn .+wrote:\r?\n/i)[0];
  text = text.split(/\r?\n-{2,}\s*Original Message\s*-{2,}/i)[0];

  // Drop lines that are pure quote markers
  text = text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n');

  // Drop common signature blocks
  text = text.split(/\r?\n--\s*\r?\n/)[0];
  text = text.split(/\r?\n(Sent from my|Regards,|Thanks,|Best,|Kind regards,)/i)[0];

  return text.trim().slice(0, 6000); // hard cap — extremely long mails still get truncated before Claude sees them
}

function localUrgencyHint(cleanedText) {
  const lower = cleanedText.toLowerCase();
  const hits = URGENT_KEYWORDS.filter((k) => lower.includes(k)).length;
  const bangs = (cleanedText.match(/!!+/g) || []).length;
  if (hits >= 2 || bangs > 0) return 'HIGH';
  if (hits === 1) return 'MEDIUM';
  return 'LOW';
}

function extractHeaderCustomer(fromHeader) {
  // "Jane Doe <jane@acme.com>" -> { name: "Jane Doe", email: "jane@acme.com" }
  const match = /^(.*?)\s*<(.+?)>$/.exec((fromHeader || '').trim());
  if (match) return { name: match[1].replace(/"/g, '').trim() || null, email: match[2].trim() };
  const emailOnly = /[^\s<>]+@[^\s<>]+/.exec(fromHeader || '');
  return { name: null, email: emailOnly ? emailOnly[0] : null };
}

// ── Layer 2: Claude structured extraction ───────────────────────────────
const SYSTEM_PROMPT = `You extract structured support-ticket fields from a customer email body.
Return ONLY a JSON object, no prose, no markdown fences, matching exactly this shape:
{
  "subject": string,          // concise ticket title, <= 12 words, written by you (do not just copy the email subject verbatim if it's vague, e.g. "Re: Re: Hi")
  "description": string,      // 2-4 sentence neutral summary of the customer's issue/request, in your own words
  "customerName": string|null,
  "productOrCategory": string, // best-guess category, e.g. "Billing", "Technical Issue", "Account Access", "Feature Request", "General Inquiry", "Refund"
  "urgency": "LOW"|"MEDIUM"|"HIGH",
  "sentiment": "POSITIVE"|"NEUTRAL"|"NEGATIVE"|"FRUSTRATED"
}
Base urgency and sentiment on the actual tone/content, not just keywords.`;

async function extractTicketFields({ subjectHeader, cleanedBody, urgencyHint, isLong }) {
  const model = isLong ? MODEL_ESCALATED : MODEL_DEFAULT;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Email subject header: ${subjectHeader || '(none)'}\nLocal urgency pre-flag (you may override): ${urgencyHint}\n\nEmail body:\n${cleanedBody}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const raw = (textBlock?.text || '{}').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();

  try {
    return JSON.parse(raw);
  } catch {
    // Fail safe: never let a malformed model response crash ingestion —
    // fall back to a minimal ticket the admin can fix by hand.
    return {
      subject: subjectHeader || 'New support ticket',
      description: cleanedBody.slice(0, 300),
      customerName: null,
      productOrCategory: 'General Inquiry',
      urgency: urgencyHint,
      sentiment: 'NEUTRAL',
    };
  }
}

/** Full pipeline entry point used by mailIngest.js. */
async function extractFromEmail({ fromHeader, subjectHeader, rawBody, receivedAt }) {
  const cleaned = cleanBody(rawBody);
  const urgencyHint = localUrgencyHint(cleaned);
  const { name: headerName, email: senderEmail } = extractHeaderCustomer(fromHeader);
  const isLong = cleaned.length > LONG_EMAIL_CHARS;

  const fields = await extractTicketFields({ subjectHeader, cleanedBody: cleaned, urgencyHint, isLong });

  return {
    subject: fields.subject || subjectHeader || 'New support ticket',
    description: fields.description || cleaned.slice(0, 300),
    customerName: fields.customerName || headerName || senderEmail || 'Unknown',
    customerEmail: senderEmail || 'unknown@unknown',
    productOrCategory: fields.productOrCategory || 'General Inquiry',
    urgency: ['LOW', 'MEDIUM', 'HIGH'].includes(fields.urgency) ? fields.urgency : urgencyHint,
    sentiment: fields.sentiment || 'NEUTRAL',
    receivedAt: receivedAt || new Date().toISOString(),
  };
}

module.exports = { extractFromEmail, cleanBody, localUrgencyHint };
