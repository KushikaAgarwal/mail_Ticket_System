const cheerio = require('cheerio');
const { htmlToText } = require('html-to-text');

function stripQuotedHtml(html) {
  const $ = cheerio.load(html);
  $('.gmail_quote, blockquote, .moz-cite-prefix ~ *').remove();
  return $.html() || '';
}

const CUT_MARKERS = [
  /^\s*On\s.{0,160}wrote:\s*$/i,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^\s*From:\s.+$/i,
  /^\s*>/,
];

function stripQuotedPlainText(raw) {
  if (!raw) return '';
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (CUT_MARKERS.some((re) => re.test(line))) break;
    if (/^\s*On\s.{0,160}$/i.test(line) && lines[i + 1] && /^\s*wrote:\s*$/i.test(lines[i + 1])) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

function extractReplyText(parsed) {
  if (parsed.html) {
    try {
      const strippedHtml = stripQuotedHtml(parsed.html);
      const text = htmlToText(strippedHtml, { wordwrap: false }).trim();
      if (text) return text;
    } catch {
      // fall through to plain-text path
    }
  }
  const fromText = stripQuotedPlainText(parsed.text || '');
  return fromText || '(no message body)';
}

module.exports = { extractReplyText };