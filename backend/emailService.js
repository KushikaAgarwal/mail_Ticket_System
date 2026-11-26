const nodemailer = require("nodemailer");
const { mailboxForZoneName } = require('./mailboxes');

const transporters = new Map();

/** One SMTP connection per mailbox, created on first use. */
function transporterFor(mailbox) {
  const m = mailbox || { email: process.env.EMAIL, password: process.env.EMAIL_APP_PASSWORD };
  if (!transporters.has(m.email)) {
    transporters.set(
      m.email,
      nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: m.email, pass: m.password },
      })
    );
  }
  return transporters.get(m.email);
}

const generalTransporter = () => transporterFor(null);

// ── Helpers for the customer-facing emails ───────────────────────────

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 775 -> "PS-775" (matches the key shown in the admin UI). */
const ticketKey = (n) => `PS-${n}`;

const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  SUPERVISOR: 'Supervisor',
  ZONAL_ADMIN: 'Zonal Admin',
  MANAGER: 'Manager',
  LEAD: 'Lead',
  CUSTOMER_SUPPORT: 'Customer Support',
};

function emailShell(inner) {
  return `
  <div style="background:#f4f5f7;padding:24px 12px;font-family:Segoe UI,Arial,sans-serif;color:#172b4d;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #dfe1e6;">
      <div style="background:#0c66e4;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:700;">PS QuickIt Support</div>
      <div style="padding:24px;font-size:14px;line-height:1.6;">${inner}</div>
      <div style="padding:14px 24px;background:#f7f8f9;color:#6b778c;font-size:12px;">
        This is an automated message from PS QuickIt Support. You can reply to this email to add information to your ticket.
      </div>
    </div>
  </div>`;
}

function ticketButton(url) {
  return `<p style="margin:22px 0;"><a href="${url}" style="background:#0c66e4;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600;display:inline-block;">Track your ticket</a></p>`;
}

// ── Customer emails ──────────────────────────────────────────────────

/** `mailbox` is the mailbox the customer wrote to (so we reply from it). */
async function sendAcknowledgementEmail({ to, customerName, subject, ticketId, ticketUrl, inReplyTo, mailbox }) {
  const key = ticketKey(ticketId);
  const from = mailbox || mailboxForZoneName(null);
  return transporterFor(from).sendMail({
    from: `"PS QuickIt Support" <${from.email}>`,
    to,
    subject: `[${key}] We’ve received your request`,
    html: emailShell(`
      <p>Hi ${esc(customerName) || 'there'},</p>
      <p>Thank you for contacting PS QuickIt. We’ve received your request and created a support ticket for it.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f4f7fb;border-radius:8px;">
        <tr><td style="padding:10px 14px;color:#6b778c;width:110px;">Ticket ID</td><td style="padding:10px 14px;font-weight:700;color:#0c66e4;">${key}</td></tr>
        <tr><td style="padding:10px 14px;color:#6b778c;">Subject</td><td style="padding:10px 14px;">${esc(subject)}</td></tr>
        <tr><td style="padding:10px 14px;color:#6b778c;">Status</td><td style="padding:10px 14px;">Received</td></tr>
      </table>
      <p>Our team is reviewing it and will get back to you as soon as possible.</p>
      ${ticketButton(ticketUrl)}
      <p style="margin-bottom:0;">Regards,<br/><strong>PS QuickIt Support Team</strong></p>
    `),
    inReplyTo: inReplyTo || undefined,
    references: inReplyTo || undefined,
  });
}

/** `zoneName` picks the sending mailbox (the ticket's zone). */
/** `zoneName` picks the sending mailbox; `attachments` is [{ filename, path }]. */
async function sendCommentEmail({ to, customerName, subject, ticketId, ticketUrl, commentText, inReplyTo, zoneName, attachments = [] }) {
  const key = ticketKey(ticketId);
  const from = mailboxForZoneName(zoneName);
  try {
    return await transporterFor(from).sendMail({
      from: `"PS QuickIt Support" <${from.email}>`,
      to,
      subject: `Re: [${key}] ${subject || 'Your support request'}`,
      html: emailShell(`
        <p>Hi ${esc(customerName) || 'there'},</p>
        <p>There’s an update on your ticket <strong style="color:#0c66e4;">${key}</strong>:</p>
        <div style="background:#f4f7fb;border-left:3px solid #0c66e4;padding:12px 16px;border-radius:6px;margin:14px 0;">
          ${esc(commentText).replace(/\n/g, '<br/>')}
        </div>
        ${attachments.length ? `<p style="color:#6b778c;font-size:13px;">Attached: ${attachments.map((a) => esc(a.filename)).join(', ')}</p>` : ''}
        ${ticketButton(ticketUrl)}
        <p style="margin-bottom:0;">Regards,<br/><strong>PS QuickIt Support Team</strong></p>
      `),
      attachments: attachments.map((a) => ({ filename: a.filename, path: a.path })),
      inReplyTo: inReplyTo || undefined,
      references: inReplyTo || undefined,
    });
  } catch (err) {
    console.error('Failed to send comment email', err);
    throw err;
  }
}

// ── Internal emails (general mailbox) ────────────────────────────────

/** NO LONGER CALLED (it caused an ingest loop). Kept only for later use
 *  from a sender that is not one of the polled mailboxes. */
async function notifyZonalStaffOfNewTicket({ recipients, subject, ticketId, ticketAdminUrl, customerName }) {
  if (!recipients.length) return;
  try {
    await generalTransporter().sendMail({
      from: `"PS QuickIt Support" <${process.env.EMAIL}>`,
      to: process.env.EMAIL,
      bcc: recipients.map((r) => r.email),
      subject: `[Internal] New ticket #${ticketId} needs assignment`,
      html: `
        <p>A new support ticket has come in and needs to be picked up.</p>
        <p>
          <strong>Ticket ID:</strong> ${ticketId}<br/>
          <strong>Customer:</strong> ${customerName || 'Unknown'}<br/>
          <strong>Subject:</strong> ${subject}
        </p>
        <p><a href="${ticketAdminUrl}">Open ticket</a></p>
      `,
    });
  } catch (err) {
    console.error('Failed to send internal zonal-staff notification', err);
  }
}

async function sendCredentialsEmail({ to, name, email, password, role, loginUrl }) {
  try {
    await generalTransporter().sendMail({
      from: `"PS QuickIt Support" <${process.env.EMAIL}>`,
      to,
      subject: 'Your account has been created',
      html: `
        <p>Hi ${name},</p>
        <p>An account has been created for you as <strong>${ROLE_LABELS[role] || role}</strong>.</p>
        <p>
          <strong>Email:</strong> ${email}<br/>
          <strong>Temporary password:</strong> ${password}
        </p>
        <p><a href="${loginUrl}">Sign in</a></p>
        <p>We'd recommend changing this password after your first login (use "Forgot password?" on the sign-in page).</p>
      `,
    });
  } catch (err) {
    console.error('Failed to send credentials email', err);
  }
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  try {
    await generalTransporter().sendMail({
      from: `"PS QuickIt Support" <${process.env.EMAIL}>`,
      to,
      subject: 'Reset your PS QuickIt password',
      html: `
        <p>Hi ${name},</p>
        <p>We received a request to reset your PS QuickIt password. This link is valid for 1 hour and can only be used once.</p>
        <p><a href="${resetUrl}">Reset your password</a></p>
        <p>If you didn't request this, you can safely ignore this email — your password won't change.</p>
      `,
    });
  } catch (err) {
    console.error('Failed to send password reset email', err);
  }
}

/** Internal mail to a teammate who was tagged in a comment. Never fails the comment. */
async function sendMentionEmail({ to, name, byName, ticketId, subject, text, ticketAdminUrl }) {
  try {
    await generalTransporter().sendMail({
      from: `"PS QuickIt Support" <${process.env.EMAIL}>`,
      to,
      subject: `${byName} mentioned you on ${ticketKey(ticketId)}`,
      html: `
        <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#172b4d;line-height:1.6;">
          <p>Hi ${esc(name)},</p>
          <p><strong>${esc(byName)}</strong> mentioned you on <strong>${ticketKey(ticketId)}</strong> (${esc(subject)}):</p>
          <div style="background:#f4f7fb;border-left:3px solid #8270db;padding:12px 16px;border-radius:6px;margin:14px 0;">
            ${esc(text).replace(/\n/g, '<br/>')}
          </div>
          <p><a href="${ticketAdminUrl}" style="background:#0c66e4;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;display:inline-block;">Open ticket</a></p>
          <p style="color:#6b778c;font-size:12px;">This is an automated message. Please don’t reply to it.</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Failed to send mention email', err);
  }
}

module.exports = {
  sendAcknowledgementEmail,
  sendMentionEmail,
  sendCommentEmail,
  notifyZonalStaffOfNewTicket,
  sendPasswordResetEmail,
  sendCredentialsEmail,
};