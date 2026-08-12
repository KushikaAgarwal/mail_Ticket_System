const fs = require('fs');
const path = require('path');

const COUNTER_FILE = path.join(__dirname, 'ticketCounter.json');

function readCounter() {
  if (!fs.existsSync(COUNTER_FILE)) return 0;
  try {
    return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')).lastNumber || 0;
  } catch {
    return 0;
  }
}

function getNextTicketNumber() {
  const next = readCounter() + 1;
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ lastNumber: next }));
  return next;
}

module.exports = { getNextTicketNumber };