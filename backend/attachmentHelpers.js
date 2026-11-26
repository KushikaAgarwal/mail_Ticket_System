// attachmentHelpers.js
// One place for everything about uploading / validating / saving / serving
// attachments, so the "add comment" route and the "create ticket" route share
// exactly the same rules.

const fs = require('fs');
const multer = require('multer');
const {
  saveBuffer,
  absolutePath,
  isBlocked,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
} = require('./attachments');
const ticketsRepo = require('./ticketsRepo');

const MB = 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

/** multipart parsing with friendly errors. Use AFTER requireAuth (+ requireTicketAccess). */
function uploadFiles(req, res, next) {
  upload.array('files', MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    let msg = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') msg = `A file is larger than ${Math.round(MAX_FILE_BYTES / MB)} MB.`;
    else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      msg = `You can attach up to ${MAX_FILES} files at a time.`;
    }
    res.status(400).json({ error: msg });
  });
}

/** multer hands filenames over as latin1; decode to utf8 and cap the length. */
function prepareFiles(req) {
  return (req.files || []).map((f) => ({
    ...f,
    originalname: Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 200),
  }));
}

/** Returns an error message, or null when the files are fine. */
function validateFiles(files) {
  const blocked = files.find((f) => isBlocked(f.originalname));
  if (blocked) {
    return `"${blocked.originalname}" is not allowed (executable and script files are blocked).`;
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return `Attachments are too large together (max ${Math.round(MAX_TOTAL_BYTES / MB)} MB).`;
  }
  return null;
}

/**
 * Save files to disk + DB. One bad file never loses the others.
 * @returns {{ saved: {filename:string, path:string}[], failed: string[] }}
 */
async function persistFiles(ticketId, files, { commentId = null, origin = 'agent' } = {}) {
  const saved = [];
  const failed = [];
  for (const f of files) {
    try {
      const rel = await saveBuffer(ticketId, f.originalname, f.buffer);
      await ticketsRepo.addAttachment(ticketId, {
        filename: f.originalname,
        contentType: f.mimetype,
        sizeBytes: f.size,
        storagePath: rel,
        commentId, // null = attached to the ticket itself
        origin,
      });
      saved.push({ filename: f.originalname, path: absolutePath(rel) });
    } catch (err) {
      console.error(`[attachments] could not save "${f.originalname}":`, err);
      failed.push(f.originalname);
    }
  }
  return { saved, failed };
}

function streamAttachment(res, att) {
  let full;
  try {
    full = absolutePath(att.storagePath);
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'The file is no longer on the server.' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(full, att.filename);
}

module.exports = { uploadFiles, prepareFiles, validateFiles, persistFiles, streamAttachment };