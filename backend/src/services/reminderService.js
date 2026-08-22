const { enqueueEmail } = require('./notificationService');
const { appointmentReminderTemplate, medicationReminderTemplate } = require('./emailService');

/**
 * Given a structured prescription (see PostVisitSummary.prescription shape) and the
 * visit date, schedules one Notification row per dose per day as a future-dated
 * email (scheduled_for). The background cron (reminderJob.js) sends whichever are
 * due on each sweep. This keeps reminder scheduling durable (survives restarts,
 * since it's DB-backed) rather than relying on in-memory setTimeout calls.
 */
async function scheduleMedicationReminders({ patient, prescription, visitDate }) {
  if (!Array.isArray(prescription) || !prescription.length) return 0;

  let scheduled = 0;
  const startDay = new Date(visitDate);
  startDay.setUTCHours(0, 0, 0, 0);

  for (const item of prescription) {
    const times = Array.isArray(item.times) && item.times.length ? item.times : ['09:00'];
    const durationDays = item.duration_days || 1;

    for (let day = 0; day < durationDays; day++) {
      for (const time of times) {
        const [hh, mm] = time.split(':').map(Number);
        const fireAt = new Date(startDay);
        fireAt.setUTCDate(fireAt.getUTCDate() + day);
        fireAt.setUTCHours(hh || 9, mm || 0, 0, 0);

        if (fireAt.getTime() < Date.now()) continue; // don't backfill past doses

        const tpl = medicationReminderTemplate({
          recipientName: patient.name,
          drug: item.drug,
          dosage: item.dosage,
          time,
        });
        await enqueueEmail({
          type: 'reminder_medication',
          recipientUserId: patient.id,
          recipientEmail: patient.email,
          subject: tpl.subject,
          text: tpl.text,
          html: tpl.html,
          scheduledFor: fireAt,
        });
        scheduled += 1;
      }
    }
  }
  return scheduled;
}

/** Schedules a single reminder email N hours before an appointment. */
async function scheduleAppointmentReminder({ patient, doctorName, slotStart, hoursBefore = 24 }) {
  const fireAt = new Date(new Date(slotStart).getTime() - hoursBefore * 3600 * 1000);
  if (fireAt.getTime() < Date.now()) return null; // too close to now, skip

  const tpl = appointmentReminderTemplate({ recipientName: patient.name, doctorName, slotStart });
  return enqueueEmail({
    type: 'reminder_appointment',
    recipientUserId: patient.id,
    recipientEmail: patient.email,
    subject: tpl.subject,
    text: tpl.text,
    html: tpl.html,
    scheduledFor: fireAt,
  });
}

module.exports = { scheduleMedicationReminders, scheduleAppointmentReminder };
