const { Op } = require('sequelize');
const { sequelize, Doctor, DoctorLeave, Appointment, User, SymptomSummary } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { enqueueEmail, } = require('./notificationService');
const emailTemplates = require('./emailService');
const calendarService = require('./calendarService');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const HOLD_TTL_SECONDS = parseInt(process.env.SLOT_HOLD_TTL_SECONDS || '300', 10);

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Computes all bookable slot start-times for a doctor on a given calendar date,
 * derived from their weekly working_hours, minus:
 *   - slots that fall within an approved leave day
 *   - slots already 'held' (and not expired) or 'confirmed'
 * Runs in-app (not DB-heavy) since working_hours are small JSON blobs.
 */
async function getAvailableSlots(doctorId, dateStr) {
  const doctor = await Doctor.findByPk(doctorId);
  if (!doctor) throw new AppError('Doctor not found', 404);

  const date = new Date(`${dateStr}T00:00:00Z`);
  const dayKey = DAY_KEYS[date.getUTCDay()];
  const ranges = doctor.working_hours?.[dayKey] || [];
  if (!ranges.length) return [];

  // 1. Check leave
  const onLeave = await DoctorLeave.findOne({
    where: { doctor_id: doctorId, start_date: { [Op.lte]: dateStr }, end_date: { [Op.gte]: dateStr } },
  });
  if (onLeave) return [];

  // 2. Build candidate slots from working hour ranges
  const slotMinutes = doctor.slot_duration_minutes;
  const candidates = [];
  for (const [startStr, endStr] of ranges) {
    let cursor = new Date(`${dateStr}T${startStr}:00Z`);
    const rangeEnd = new Date(`${dateStr}T${endStr}:00Z`);
    while (cursor.getTime() + slotMinutes * 60000 <= rangeEnd.getTime()) {
      candidates.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + slotMinutes * 60000);
    }
  }

  // 3. Remove candidates that collide with active (held-not-expired / confirmed) appointments
  const dayStart = new Date(`${dateStr}T00:00:00Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59Z`);
  const existing = await Appointment.findAll({
    where: {
      doctor_id: doctorId,
      slot_start: { [Op.between]: [dayStart, dayEnd] },
      [Op.or]: [{ status: 'confirmed' }, { status: 'held', hold_expires_at: { [Op.gt]: new Date() } }],
    },
  });
  const takenTimes = new Set(existing.map((a) => a.slot_start.toISOString()));

  return candidates.filter((c) => !takenTimes.has(c.toISOString())).map((c) => c.toISOString());
}

/**
 * Step 1 of booking: place a short-lived HOLD on a slot so the patient can safely
 * fill out the symptom form without another patient stealing the slot mid-form.
 *
 * Concurrency safety: relies on the DB-level partial unique index
 * uniq_doctor_slot_active (doctor_id, slot_start) WHERE status IN (held, confirmed).
 * If two requests race for the same slot, the DB itself rejects the second INSERT
 * with a UniqueConstraintError - we don't rely on an app-level check-then-write,
 * which would be vulnerable to a race condition between the check and the write.
 */
async function holdSlot({ patientId, doctorId, slotStartISO }) {
  const doctor = await Doctor.findByPk(doctorId);
  if (!doctor) throw new AppError('Doctor not found', 404);

  const slotStart = new Date(slotStartISO);
  const slotEnd = new Date(slotStart.getTime() + doctor.slot_duration_minutes * 60000);

  const dateStr = toDateOnly(slotStart);
  const onLeave = await DoctorLeave.findOne({
    where: { doctor_id: doctorId, start_date: { [Op.lte]: dateStr }, end_date: { [Op.gte]: dateStr } },
  });
  if (onLeave) throw new AppError('Doctor is on leave on the selected date', 409);

  try {
    // Sequelize + SQLite: wrap in a transaction so the unique-index check is atomic.
    const appointment = await sequelize.transaction(async (t) => {
      return Appointment.create(
        {
          patient_id: patientId,
          doctor_id: doctorId,
          slot_start: slotStart,
          slot_end: slotEnd,
          status: 'held',
          hold_expires_at: new Date(Date.now() + HOLD_TTL_SECONDS * 1000),
        },
        { transaction: t }
      );
    });
    return appointment;
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw new AppError('That slot was just booked by someone else. Please choose another slot.', 409);
    }
    throw err;
  }
}

/**
 * Step 2 of booking: patient submits symptoms -> LLM pre-visit summary is generated
 * -> hold is confirmed. If the hold expired in the meantime, the caller must re-hold.
 */
async function confirmBooking({ appointmentId, patientId, symptomSummaryData }) {
  const appointment = await Appointment.findByPk(appointmentId, { include: [Doctor] });
  if (!appointment) throw new AppError('Appointment not found', 404);
  if (appointment.patient_id !== patientId) throw new AppError('Not your appointment', 403);
  if (appointment.status !== 'held') throw new AppError(`Cannot confirm appointment in status '${appointment.status}'`, 409);
  if (appointment.hold_expires_at && appointment.hold_expires_at.getTime() < Date.now()) {
    appointment.status = 'cancelled';
    appointment.cancelled_reason = 'hold_expired';
    await appointment.save();
    throw new AppError('Your slot hold expired. Please select a slot again.', 409);
  }

  appointment.status = 'confirmed';
  appointment.hold_expires_at = null;
  await appointment.save();

  if (symptomSummaryData) {
    await SymptomSummary.create({ appointment_id: appointment.id, ...symptomSummaryData });
  }

  await sendBookingConfirmations(appointment);
  return appointment;
}

async function sendBookingConfirmations(appointment) {
  const patient = await User.findByPk(appointment.patient_id);
  const doctor = await Doctor.findByPk(appointment.doctor_id, { include: [User] });
  const doctorUser = doctor.User;

  const patientTpl = emailTemplates.bookingConfirmationTemplate({
    recipientName: patient.name,
    doctorName: doctorUser.name,
    patientName: patient.name,
    slotStart: appointment.slot_start,
    role: 'patient',
  });
  await enqueueEmail({
    type: 'booking_confirmation',
    recipientUserId: patient.id,
    recipientEmail: patient.email,
    appointmentId: appointment.id,
    subject: patientTpl.subject,
    text: patientTpl.text,
    html: patientTpl.html,
  });

  const doctorTpl = emailTemplates.bookingConfirmationTemplate({
    recipientName: doctorUser.name,
    doctorName: doctorUser.name,
    patientName: patient.name,
    slotStart: appointment.slot_start,
    role: 'doctor',
  });
  await enqueueEmail({
    type: 'booking_confirmation',
    recipientUserId: doctorUser.id,
    recipientEmail: doctorUser.email,
    appointmentId: appointment.id,
    subject: doctorTpl.subject,
    text: doctorTpl.text,
    html: doctorTpl.html,
  });

  // Calendar events for both parties (dry-run safe, see calendarService.js)
  const patientEvent = await calendarService.createEvent({
    refreshToken: null, // see README "Known simplifications" re: per-user token storage
    summary: `Appointment with Dr. ${doctorUser.name}`,
    description: 'Healthcare Appointment Manager booking',
    startISO: appointment.slot_start.toISOString(),
    endISO: appointment.slot_end.toISOString(),
    attendeeEmail: patient.email,
  });
  const doctorEvent = await calendarService.createEvent({
    refreshToken: null,
    summary: `Appointment with ${patient.name}`,
    description: 'Healthcare Appointment Manager booking',
    startISO: appointment.slot_start.toISOString(),
    endISO: appointment.slot_end.toISOString(),
    attendeeEmail: doctorUser.email,
  });
  appointment.google_calendar_event_id_patient = patientEvent.id;
  appointment.google_calendar_event_id_doctor = doctorEvent.id;
  await appointment.save();
}

async function cancelAppointment({ appointmentId, cancelledBy, reason }) {
  const appointment = await Appointment.findByPk(appointmentId, { include: [Doctor] });
  if (!appointment) throw new AppError('Appointment not found', 404);
  if (['cancelled', 'completed'].includes(appointment.status)) {
    throw new AppError(`Appointment already ${appointment.status}`, 409);
  }

  appointment.status = 'cancelled';
  appointment.cancelled_reason = reason || 'cancelled_by_user';
  appointment.cancelled_by = cancelledBy;
  await appointment.save();

  const patient = await User.findByPk(appointment.patient_id);
  const doctor = await Doctor.findByPk(appointment.doctor_id, { include: [User] });
  const doctorUser = doctor.User;

  if (appointment.google_calendar_event_id_patient) {
    await calendarService.deleteEvent({ refreshToken: null, eventId: appointment.google_calendar_event_id_patient });
  }
  if (appointment.google_calendar_event_id_doctor) {
    await calendarService.deleteEvent({ refreshToken: null, eventId: appointment.google_calendar_event_id_doctor });
  }

  const patientTpl = emailTemplates.cancellationTemplate({
    recipientName: patient.name,
    doctorName: doctorUser.name,
    patientName: patient.name,
    slotStart: appointment.slot_start,
    role: 'patient',
    reason,
  });
  await enqueueEmail({
    type: 'cancellation',
    recipientUserId: patient.id,
    recipientEmail: patient.email,
    appointmentId: appointment.id,
    subject: patientTpl.subject,
    text: patientTpl.text,
    html: patientTpl.html,
  });

  const doctorTpl = emailTemplates.cancellationTemplate({
    recipientName: doctorUser.name,
    doctorName: doctorUser.name,
    patientName: patient.name,
    slotStart: appointment.slot_start,
    role: 'doctor',
    reason,
  });
  await enqueueEmail({
    type: 'cancellation',
    recipientUserId: doctorUser.id,
    recipientEmail: doctorUser.email,
    appointmentId: appointment.id,
    subject: doctorTpl.subject,
    text: doctorTpl.text,
    html: doctorTpl.html,
  });

  return appointment;
}

/**
 * Called after a DoctorLeave is created for a date range. Finds every CONFIRMED
 * appointment that now overlaps the leave, cancels it, and notifies the patient
 * (assignment requirement: "affected patients must be notified").
 */
async function handleLeaveConflicts(doctorId, startDate, endDate) {
  const rangeStart = new Date(`${startDate}T00:00:00Z`);
  const rangeEnd = new Date(`${endDate}T23:59:59Z`);

  const affected = await Appointment.findAll({
    where: {
      doctor_id: doctorId,
      status: 'confirmed',
      slot_start: { [Op.between]: [rangeStart, rangeEnd] },
    },
  });

  const results = [];
  for (const appt of affected) {
    await cancelAppointment({ appointmentId: appt.id, cancelledBy: null, reason: 'doctor_on_leave' });

    const patient = await User.findByPk(appt.patient_id);
    const doctor = await Doctor.findByPk(doctorId, { include: [User] });
    const tpl = emailTemplates.leaveConflictTemplate({
      recipientName: patient.name,
      doctorName: doctor.User.name,
      slotStart: appt.slot_start,
    });
    await enqueueEmail({
      type: 'leave_conflict',
      recipientUserId: patient.id,
      recipientEmail: patient.email,
      appointmentId: appt.id,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
    });
    results.push(appt.id);
  }
  return results;
}

/** Background sweep: releases expired holds so slots become bookable again. */
async function releaseExpiredHolds() {
  const [count] = await Appointment.update(
    { status: 'cancelled', cancelled_reason: 'hold_expired' },
    { where: { status: 'held', hold_expires_at: { [Op.lt]: new Date() } } }
  );
  if (count) console.log(`[appointmentService] released ${count} expired slot holds`);
  return count;
}

module.exports = {
  getAvailableSlots,
  holdSlot,
  confirmBooking,
  cancelAppointment,
  handleLeaveConflicts,
  releaseExpiredHolds,
};
