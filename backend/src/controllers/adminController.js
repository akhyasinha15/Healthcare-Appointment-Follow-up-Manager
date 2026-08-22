const bcrypt = require('bcryptjs');
const { User, Doctor, DoctorLeave } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { handleLeaveConflicts } = require('../services/appointmentService');

// Admin creates a doctor account + profile in one step
async function createDoctor(req, res) {
  const { name, email, password, phone, specialisation, slot_duration_minutes, working_hours, bio, consultation_fee } = req.body;
  if (!name || !email || !password || !specialisation || !working_hours) {
    throw new AppError('name, email, password, specialisation and working_hours are required');
  }

  const existing = await User.findOne({ where: { email } });
  if (existing) throw new AppError('Email already registered', 409);

  const password_hash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, password_hash, phone, role: 'doctor' });
  const doctor = await Doctor.create({
    user_id: user.id,
    specialisation,
    slot_duration_minutes: slot_duration_minutes || 30,
    working_hours,
    bio,
    consultation_fee,
  });

  res.status(201).json({ doctor: { ...doctor.toJSON(), user: { id: user.id, name: user.name, email: user.email } } });
}

async function updateDoctor(req, res) {
  const doctor = await Doctor.findByPk(req.params.doctorId);
  if (!doctor) throw new AppError('Doctor not found', 404);

  const { specialisation, slot_duration_minutes, working_hours, bio, consultation_fee } = req.body;
  await doctor.update({
    specialisation: specialisation ?? doctor.specialisation,
    slot_duration_minutes: slot_duration_minutes ?? doctor.slot_duration_minutes,
    working_hours: working_hours ?? doctor.working_hours,
    bio: bio ?? doctor.bio,
    consultation_fee: consultation_fee ?? doctor.consultation_fee,
  });
  res.json({ doctor });
}

async function listDoctors(req, res) {
  const doctors = await Doctor.findAll({ include: [User] });
  res.json({ doctors });
}

async function deactivateDoctor(req, res) {
  const doctor = await Doctor.findByPk(req.params.doctorId, { include: [User] });
  if (!doctor) throw new AppError('Doctor not found', 404);
  doctor.User.is_active = false;
  await doctor.User.save();
  res.json({ message: 'Doctor deactivated' });
}

// Creates a leave record and cancels+notifies patients with conflicting confirmed bookings
async function createLeave(req, res) {
  const { doctorId } = req.params;
  const { start_date, end_date, reason } = req.body;
  if (!start_date || !end_date) throw new AppError('start_date and end_date are required');

  const doctor = await Doctor.findByPk(doctorId);
  if (!doctor) throw new AppError('Doctor not found', 404);

  const leave = await DoctorLeave.create({ doctor_id: doctorId, start_date, end_date, reason, created_by: req.user.id });
  const cancelledAppointmentIds = await handleLeaveConflicts(doctorId, start_date, end_date);

  res.status(201).json({ leave, cancelledAppointmentIds, message: `${cancelledAppointmentIds.length} affected patient(s) notified` });
}

async function listLeaves(req, res) {
  const leaves = await DoctorLeave.findAll({ where: { doctor_id: req.params.doctorId } });
  res.json({ leaves });
}

module.exports = { createDoctor, updateDoctor, listDoctors, deactivateDoctor, createLeave, listLeaves };
