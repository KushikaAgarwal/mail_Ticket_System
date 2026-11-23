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

async function sendAcknowledgementEmail({
    to,
    customerName,
    subject,
    ticketId,
    ticketUrl,
     inReplyTo,      
}) {
    try {
       
        const info = await transporter.sendMail({
            from: `"PS QuickIt Support" <${process.env.EMAIL}>`,
            to,
            subject: `[PS QuickIt] Support Ticket Created (#${ticketId})`,
            html: `
                <h2>Thank you for contacting PS QuickIt</h2>

                <p>Hi ${customerName || "Customer"},</p>

                <p>
                    We have successfully received your support request.
                    Your ticket has been created successfully.
                </p>

                <p>
                    <strong>Ticket ID:</strong><br/>
                    <a href="${ticketUrl}">
                        ${ticketId}
                    </a>
                </p>

                <p>
                    <strong>Issue:</strong><br/>
                    ${subject}
                </p>

                <p>
                    Our support team is reviewing your request and will
                    respond as soon as possible.
                </p>

                <hr/>

                <p>
                    Regards,<br/>
                    <strong>PS QuickIt Support Team</strong>
                </p>
            `,
            inReplyTo: inReplyTo || undefined,
            references: inReplyTo || undefined, 
        });

        return info;
    } catch (err) {
       
        throw err;
    }
}

async function sendCommentEmail({ to, customerName, subject, ticketId, ticketUrl, commentText, inReplyTo }) {
  try {
    const info = await transporter.sendMail({
      from: `"PS QuickIt Support" <${process.env.EMAIL}>`,
      to,
      subject: `Re: [PS QuickIt] Support Ticket Created (#${ticketId})`,
      html: `
        <p>Hi ${customerName || "Customer"},</p>
        <p>${commentText.replace(/\n/g, '<br/>')}</p>
        <p><strong>Ticket:</strong><br/><a href="${ticketUrl}">${ticketId}</a></p>
        <hr/>
        <p>Regards,<br/><strong>PS QuickIt Support Team</strong></p>
      `,
      inReplyTo: inReplyTo || undefined,
      references: inReplyTo || undefined,
    });
    return info;
  } catch (err) {
    console.error("Failed to send comment email", err);
    throw err;
  }
}
// ── ADD this function to emailService.js, and export it ─────────────

/** Internal-only notification, separate from the customer's
 *  acknowledgement email — goes to every active Zonal Admin + Zonal
 *  Executive so the whole delegation pool knows a ticket needs picking
 *  up, without exposing internal addresses to the customer via CC. */
async function notifyZonalStaffOfNewTicket({ recipients, subject, ticketId, ticketAdminUrl, customerName }) {
  if (!recipients.length) return;
  try {
    await transporter.sendMail({
      from: `"PS QuickIt Support" <${process.env.EMAIL}>`,
      to: process.env.EMAIL, // send to self, real recipients in BCC
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
    // Deliberately not re-thrown — a failed internal notification
    // shouldn't fail ticket creation itself.
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
        <p>An account has been created for you as <strong>${role}</strong>.</p>
        <p>
          <strong>Email:</strong> ${email}<br/>
          <strong>Temporary password:</strong> ${password}
        </p>
        <p>
          <a href="${loginUrl}">Sign in</a>
        </p>
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
module.exports = { sendAcknowledgementEmail, sendCommentEmail, notifyZonalStaffOfNewTicket, sendPasswordResetEmail, sendCredentialsEmail };