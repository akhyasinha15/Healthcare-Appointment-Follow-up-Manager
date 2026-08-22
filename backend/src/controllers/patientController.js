const { Op } = require('sequelize');
const { Doctor, User, Appointment, SymptomSummary, PostVisitSummary } = require('../models');

async function searchDoctors(req, res) {
  const { specialisation, q } = req.query;
  const where = {};
  if (specialisation) where.specialisation = { [Op.like]: `%${specialisation}%` };

  const include = [{ model: User, where: q ? { name: { [Op.like]: `%${q}%` } } : undefined, attributes: ['id', 'name', 'email'] }];

  const doctors = await Doctor.findAll({ where, include });
  res.json({ doctors });
}

async function myAppointments(req, res) {
  const appointments = await Appointment.findAll({
    where: { patient_id: req.user.id },
    include: [
      { model: Doctor, include: [User] },
      SymptomSummary,
      PostVisitSummary,
    ],
    order: [['slot_start', 'DESC']],
  });
  res.json({ appointments });
}

module.exports = { searchDoctors, myAppointments };
