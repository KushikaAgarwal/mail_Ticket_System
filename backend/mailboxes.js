require('dotenv').config();

const ZONES = ['North', 'South', 'East', 'West'];

// The general mailbox has no zone; each zone mailbox tags its tickets with that zone.
const MAILBOXES = [
  { key: 'general', zoneName: null, email: process.env.EMAIL, password: process.env.EMAIL_APP_PASSWORD },
  ...ZONES.map((z) => ({
    key: z.toLowerCase(),
    zoneName: z,
    email: process.env[`MAILBOX_${z.toUpperCase()}_EMAIL`],
    password: process.env[`MAILBOX_${z.toUpperCase()}_PASSWORD`],
  })),
].filter((m) => m.email && m.password);

/** Every address we own, so our own mail is never turned into a ticket. */
const ownAddresses = () => new Set(MAILBOXES.map((m) => m.email.toLowerCase()));

/** The mailbox that should send mail for a zone (falls back to the general one). */
function mailboxForZoneName(zoneName) {
  return (
    MAILBOXES.find((m) => m.zoneName && m.zoneName === zoneName) ||
    MAILBOXES.find((m) => m.key === 'general') ||
    MAILBOXES[0]
  );
}

module.exports = { MAILBOXES, ownAddresses, mailboxForZoneName };