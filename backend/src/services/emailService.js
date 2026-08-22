const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

/**
 * Sends a single email. Throws on failure so the caller (notification outbox
 * worker) can record the failure and retry later - we never swallow errors here.
 * EMAIL_DRY_RUN=true logs instead of hitting a real SMTP/SendGrid/Mailgun server,
 * which keeps local dev & grading working without real credentials.
 */
async function sendEmail({ to, subject, html, text }) {
  if (process.env.EMAIL_DRY_RUN === 'true') {
    console.log(`\n[emailService][DRY RUN] To: ${to}\nSubject: ${subject}\n${text || html}\n`);
    return { messageId: `dry-run-${Date.now()}` };
  }
  const info = await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
  });
  return info;
}

// ---- Templates ----

function bookingConfirmationTemplate({ recipientName, doctorName, patientName, slotStart, role }) {
  const when = new Date(slotStart).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
  const subject = `Appointment Confirmed - ${when}`;
  const text =
    role === 'doctor'
      ? `Hi Dr. ${doctorName}, you have a new appointment with ${patientName} on ${when}.`
      : `Hi ${recipientName}, your appointment with Dr. ${doctorName} is confirmed for ${when}. A calendar invite has been sent to you.`;
  return { subject, text, html: `<p>${text}</p>` };
}

function cancellationTemplate({ recipientName, doctorName, patientName, slotStart, role, reason }) {
  const when = new Date(slotStart).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
  const subject = `Appointment Cancelled - ${when}`;
  const reasonText = reason ? ` Reason: ${reason}.` : '';
  const text =
    role === 'doctor'
      ? `Hi Dr. ${doctorName}, the appointment with ${patientName} on ${when} has been cancelled.${reasonText}`
      : `Hi ${recipientName}, your appointment with Dr. ${doctorName} on ${when} has been cancelled.${reasonText} Please book a new slot at your convenience.`;
  return { subject, text, html: `<p>${text}</p>` };
}

function leaveConflictTemplate({ recipientName, doctorName, slotStart }) {
  const when = new Date(slotStart).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
  const subject = `Your appointment on ${when} needs to be rescheduled`;
  const text = `Hi ${recipientName}, Dr. ${doctorName} is unavailable on ${when} due to unforeseen leave. Your appointment has been cancelled and marked for reschedule - we're sorry for the inconvenience. Please log in to book a new slot.`;
  return { subject, text, html: `<p>${text}</p>` };
}

function appointmentReminderTemplate({ recipientName, doctorName, slotStart }) {
  const when = new Date(slotStart).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
  const subject = `Reminder: appointment with Dr. ${doctorName} on ${when}`;
  const text = `Hi ${recipientName}, this is a reminder of your upcoming appointment with Dr. ${doctorName} on ${when}.`;
  return { subject, text, html: `<p>${text}</p>` };
}

function medicationReminderTemplate({ recipientName, drug, dosage, time }) {
  const subject = `Medication reminder: ${drug}`;
  const text = `Hi ${recipientName}, it's time to take your medication: ${drug} (${dosage || 'as prescribed'}) at ${time}.`;
  return { subject, text, html: `<p>${text}</p>` };
}

module.exports = {
  sendEmail,
  bookingConfirmationTemplate,
  cancellationTemplate,
  leaveConflictTemplate,
  appointmentReminderTemplate,
  medicationReminderTemplate,
};
