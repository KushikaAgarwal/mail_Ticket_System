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

module.exports = { sendAcknowledgementEmail, sendCommentEmail };