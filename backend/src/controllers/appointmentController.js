const { Appointment, Doctor, User } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const appointmentService = require('../services/appointmentService');
const llmService = require('../services/llmService');
const reminderService = require('../services/reminderService');

async function getSlots(req, res) {
  const { doctorId } = req.params;
  const { date } = req.query; // YYYY-MM-DD
  if (!date) throw new AppError('date query param (YYYY-MM-DD) is required');
  const slots = await appointmentService.getAvailableSlots(doctorId, date);
  res.json({ doctorId, date, slots });
}

// Step 1: place a temporary hold on a slot
async function hold(req, res) {
  const { doctorId, slotStart } = req.body;
  if (!doctorId || !slotStart) throw new AppError('doctorId and slotStart are required');

  const appointment = await appointmentService.holdSlot({
    patientId: req.user.id,
    doctorId,
    slotStartISO: slotStart,
  });
  res.status(201).json({
    appointment,
    holdExpiresInSeconds: parseInt(process.env.SLOT_HOLD_TTL_SECONDS || '300', 10),
  });
}

// Step 2: patient submits symptom form -> LLM pre-visit summary -> confirm booking
async function confirm(req, res) {
  const { appointmentId } = req.params;
  const { symptoms, durationDays } = req.body;
  if (!symptoms) throw new AppError('symptoms text is required');

  const llmResult = await llmService.generatePreVisitSummary({ symptoms, durationDays });

  const appointment = await appointmentService.confirmBooking({
    appointmentId,
    patientId: req.user.id,
    symptomSummaryData: {
      raw_symptoms: symptoms,
      duration_days: durationDays || null,
      urgency_level: llmResult.urgency_level,
      chief_complaint: llmResult.chief_complaint,
      suggested_questions: llmResult.suggested_questions,
      llm_status: llmResult.status,
      llm_error: llmResult.error || null,
      llm_raw_response: llmResult.raw || null,
    },
  });

  // Schedule a 24h-before reminder (durable, DB-backed - see reminderService.js)
  const patient = await User.findByPk(req.user.id);
  const doctor = await Doctor.findByPk(appointment.doctor_id, { include: [User] });
  await reminderService.scheduleAppointmentReminder({
    patient,
    doctorName: doctor.User.name,
    slotStart: appointment.slot_start,
    hoursBefore: 24,
  });

  res.json({ appointment, preVisitSummary: llmResult });
}

async function cancel(req, res) {
  const { appointmentId } = req.params;
  const { reason } = req.body;

  const appointment = await Appointment.findByPk(appointmentId);
  if (!appointment) throw new AppError('Appointment not found', 404);

  const isOwnerPatient = req.user.role === 'patient' && appointment.patient_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  let isOwnerDoctor = false;
  if (req.user.role === 'doctor') {
    const doctorProfile = await Doctor.findOne({ where: { user_id: req.user.id } });
    isOwnerDoctor = doctorProfile && doctorProfile.id === appointment.doctor_id;
  }
  if (!isOwnerPatient && !isOwnerDoctor && !isAdmin) throw new AppError('Not authorized to cancel this appointment', 403);

  const updated = await appointmentService.cancelAppointment({
    appointmentId,
    cancelledBy: req.user.id,
    reason: reason || 'cancelled_by_user',
  });
  res.json({ appointment: updated });
}

module.exports = { getSlots, hold, confirm, cancel };
