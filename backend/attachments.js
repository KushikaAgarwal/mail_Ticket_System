const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
const MAX_FILE_BYTES = (Number(process.env.MAX_ATTACHMENT_MB) || 10) * 1024 * 1024; // per file, agents
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;   // per comment (mail providers cap near 25 MB)
const INBOUND_MAX_BYTES = 20 * 1024 * 1024; // per file, customers

// Executables and scripts are never stored or sent.
const BLOCKED_EXT = new Set([
  'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'js', 'jse', 'vbs', 'vbe',
  'wsf', 'ps1', 'jar', 'dll', 'lnk', 'reg', 'hta', 'cpl',
]);

function safeName(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.\- ()\[\]]+/g, '_').slice(0, 120);
  return base || 'file';
}

const isBlocked = (name) => BLOCKED_EXT.has(path.extname(String(name || '')).slice(1).toLowerCase());

/** Saves a file under uploads/<ticketKey>/ and returns its path relative to the upload root. */
async function saveBuffer(ticketKey, filename, buffer) {
  const dir = path.join(UPLOAD_ROOT, String(ticketKey).replace(/[^\w-]/g, '_'));
  await fs.promises.mkdir(dir, { recursive: true });
  const stored = `${crypto.randomUUID()}-${safeName(filename)}`;
  const full = path.join(dir, stored);
  await fs.promises.writeFile(full, buffer);
  return path.relative(UPLOAD_ROOT, full);
}

/** Relative stored path -> absolute path, refusing anything outside the upload folder. */
function absolutePath(rel) {
  const full = path.resolve(UPLOAD_ROOT, rel);
  if (!full.startsWith(UPLOAD_ROOT + path.sep)) throw new Error('Invalid file path');
  return full;
}

module.exports = {
  UPLOAD_ROOT, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, INBOUND_MAX_BYTES,
  safeName, isBlocked, saveBuffer, absolutePath,
};