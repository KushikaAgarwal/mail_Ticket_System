const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

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

async function sendAcknowledgementEmail({ to, customerName, subject, ticketId, ticketUrl, inReplyTo }) {
  const key = ticketKey(ticketId);
  return transporter.sendMail({
    from: `"PS QuickIt Support" <${process.env.EMAIL}>`,
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

async function sendCommentEmail({ to, customerName, subject, ticketId, ticketUrl, commentText, inReplyTo }) {
  const key = ticketKey(ticketId);
  try {
    return await transporter.sendMail({
      from: `"PS QuickIt Support" <${process.env.EMAIL}>`,
      to,
      subject: `Re: [${key}] ${subject || 'Your support request'}`,
      html: emailShell(`
        <p>Hi ${esc(customerName) || 'there'},</p>
        <p>There’s an update on your ticket <strong style="color:#0c66e4;">${key}</strong>:</p>
        <div style="background:#f4f7fb;border-left:3px solid #0c66e4;padding:12px 16px;border-radius:6px;margin:14px 0;">
          ${esc(commentText).replace(/\n/g, '<br/>')}
        </div>
        ${ticketButton(ticketUrl)}
        <p style="margin-bottom:0;">Regards,<br/><strong>PS QuickIt Support Team</strong></p>
      `),
      inReplyTo: inReplyTo || undefined,
      references: inReplyTo || undefined,
    });
  } catch (err) {
    console.error("Failed to send comment email", err);
    throw err;
  }
}

// ── Internal emails ──────────────────────────────────────────────────

/** NO LONGER CALLED. mailIngest.js stopped using it because the alert was
 *  sent to the polled inbox and was re-ingested as a new ticket (loop).
 *  Kept only in case you later send alerts from a different address. */
async function notifyZonalStaffOfNewTicket({ recipients, subject, ticketId, ticketAdminUrl, customerName }) {
  if (!recipients.length) return;
  try {
    await transporter.sendMail({
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
    await transporter.sendMail({
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
    // Not re-thrown — a failed notification shouldn't fail account creation.
  }
}

/** Sent when someone requests a password reset. Link contains a
 *  single-use, hashed-at-rest, time-limited token (see usersRepo.js). */
async function sendPasswordResetEmail({ to, name, resetUrl }) {
  try {
    await transporter.sendMail({
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

module.exports = {
  sendAcknowledgementEmail,
  sendCommentEmail,
  notifyZonalStaffOfNewTicket,
  sendPasswordResetEmail,
  sendCredentialsEmail,
};