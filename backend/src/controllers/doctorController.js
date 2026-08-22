const { Doctor, Appointment, User, SymptomSummary, PostVisitSummary } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const llmService = require('../services/llmService');
const reminderService = require('../services/reminderService');

async function getMyProfile(req, res) {
  const doctor = await Doctor.findOne({ where: { user_id: req.user.id } });
  if (!doctor) throw new AppError('Doctor profile not found', 404);
  res.json({ doctor });
}

async function myAppointments(req, res) {
  const doctor = await Doctor.findOne({ where: { user_id: req.user.id } });
  if (!doctor) throw new AppError('Doctor profile not found', 404);

  const appointments = await Appointment.findAll({
    where: { doctor_id: doctor.id },
    include: [{ model: User, as: 'patient', attributes: ['id', 'name', 'email', 'phone'] }, SymptomSummary, PostVisitSummary],
    order: [['slot_start', 'ASC']],
  });
  res.json({ appointments });
}

// Doctor submits post-visit clinical notes + prescription -> LLM patient-friendly summary
async function submitPostVisit(req, res) {
  const { appointmentId } = req.params;
  const { clinical_notes, diagnosis, prescription, follow_up_date } = req.body;
  if (!clinical_notes) throw new AppError('clinical_notes is required');

  const appointment = await Appointment.findByPk(appointmentId, { include: [Doctor] });
  if (!appointment) throw new AppError('Appointment not found', 404);

  const doctor = await Doctor.findOne({ where: { user_id: req.user.id } });
  if (!doctor || doctor.id !== appointment.doctor_id) throw new AppError('Not authorized for this appointment', 403);

  const llmResult = await llmService.generatePostVisitSummary({
    notes: clinical_notes,
    prescription,
    followUpDate: follow_up_date,
  });

  const summary = await PostVisitSummary.create({
    appointment_id: appointment.id,
    clinical_notes,
    diagnosis,
    prescription: prescription || [],
    follow_up_date: follow_up_date || null,
    patient_summary: llmResult.patient_summary,
    medication_schedule_text: llmResult.medication_schedule_text,
    follow_up_steps: llmResult.follow_up_steps,
    llm_status: llmResult.status,
    llm_error: llmResult.error || null,
  });

  appointment.status = 'completed';
  await appointment.save();

  const patient = await User.findByPk(appointment.patient_id);
  const scheduledCount = await reminderService.scheduleMedicationReminders({
    patient,
    prescription: prescription || [],
    visitDate: appointment.slot_start,
  });

  res.status(201).json({ summary, medicationRemindersScheduled: scheduledCount });
}

module.exports = { getMyProfile, myAppointments, submitPostVisit };
