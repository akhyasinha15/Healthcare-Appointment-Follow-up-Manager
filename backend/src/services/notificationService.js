const { Notification, User } = require('../models');
const { sendEmail } = require('./emailService');

const MAX_ATTEMPTS = parseInt(process.env.NOTIFICATION_RETRY_MAX_ATTEMPTS || '5', 10);

/**
 * Outbox pattern: write the notification row FIRST (status='pending'), then attempt
 * to send immediately. If the immediate send fails (SMTP down, rate limited, etc.)
 * the row stays 'pending'/'failed' and the background sweep (reminderJob.js) will
 * retry it with exponential backoff until MAX_ATTEMPTS is reached, at which point
 * it is marked 'abandoned' and surfaced to admins rather than retried forever.
 */
async function enqueueEmail({ type, recipientUserId, recipientEmail, appointmentId, subject, text, html, scheduledFor }) {
  const notification = await Notification.create({
    type,
    channel: 'email',
    recipient_user_id: recipientUserId,
    recipient_email: recipientEmail,
    appointment_id: appointmentId || null,
    subject,
    body: text,
    status: 'pending',
    scheduled_for: scheduledFor || new Date(),
  });

  // Only attempt immediately if due now; future-dated reminders (e.g. medication
  // reminders, appointment reminders) are picked up later by the cron sweep.
  const due = !scheduledFor || new Date(scheduledFor).getTime() <= Date.now();
  if (due) {
    // Fire-and-forget immediate attempt (don't block the HTTP response on email delivery)
    attemptSend(notification, html).catch((err) => console.error('[notificationService] immediate send failed:', err.message));
  }

  return notification;
}

async function attemptSend(notification, html) {
  try {
    await sendEmail({ to: notification.recipient_email, subject: notification.subject, text: notification.body, html });
    notification.status = 'sent';
    notification.sent_at = new Date();
    notification.attempts += 1;
    await notification.save();
    return true;
  } catch (err) {
    notification.attempts += 1;
    notification.last_error = err.message;
    notification.status = notification.attempts >= MAX_ATTEMPTS ? 'abandoned' : 'failed';
    await notification.save();
    return false;
  }
}

/**
 * Background sweep: retries any notification stuck in 'pending' or 'failed' whose
 * scheduled_for time has passed and attempts < MAX_ATTEMPTS. Called by the cron job.
 */
async function retryFailedNotifications() {
  const { Op } = require('sequelize');
  const due = await Notification.findAll({
    where: {
      status: ['pending', 'failed'],
      attempts: { [Op.lt]: MAX_ATTEMPTS },
      scheduled_for: { [Op.lte]: new Date() },
    },
    limit: 50,
  });

  let sent = 0;
  for (const n of due) {
    const ok = await attemptSend(n, n.body ? `<p>${n.body}</p>` : undefined);
    if (ok) sent += 1;
  }
  if (due.length) console.log(`[notificationService] retry sweep: ${sent}/${due.length} sent`);
  return { checked: due.length, sent };
}

module.exports = { enqueueEmail, retryFailedNotifications };
