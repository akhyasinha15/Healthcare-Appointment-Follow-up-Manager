const sequelize = require('../config/db');
const User = require('./User');
const Doctor = require('./Doctor');
const DoctorLeave = require('./DoctorLeave');
const Appointment = require('./Appointment');
const SymptomSummary = require('./SymptomSummary');
const PostVisitSummary = require('./PostVisitSummary');
const Notification = require('./Notification');

// User <-> Doctor (1:1)
User.hasOne(Doctor, { foreignKey: 'user_id', onDelete: 'CASCADE' });
Doctor.belongsTo(User, { foreignKey: 'user_id' });

// Doctor -> Leaves (1:N)
Doctor.hasMany(DoctorLeave, { foreignKey: 'doctor_id', onDelete: 'CASCADE' });
DoctorLeave.belongsTo(Doctor, { foreignKey: 'doctor_id' });

// Patient/Doctor -> Appointments
User.hasMany(Appointment, { foreignKey: 'patient_id', as: 'patientAppointments' });
Appointment.belongsTo(User, { foreignKey: 'patient_id', as: 'patient' });

Doctor.hasMany(Appointment, { foreignKey: 'doctor_id' });
Appointment.belongsTo(Doctor, { foreignKey: 'doctor_id' });

// Appointment -> SymptomSummary (1:1)
Appointment.hasOne(SymptomSummary, { foreignKey: 'appointment_id', onDelete: 'CASCADE' });
SymptomSummary.belongsTo(Appointment, { foreignKey: 'appointment_id' });

// Appointment -> PostVisitSummary (1:1)
Appointment.hasOne(PostVisitSummary, { foreignKey: 'appointment_id', onDelete: 'CASCADE' });
PostVisitSummary.belongsTo(Appointment, { foreignKey: 'appointment_id' });

// Appointment -> Notifications (1:N)
Appointment.hasMany(Notification, { foreignKey: 'appointment_id' });
Notification.belongsTo(Appointment, { foreignKey: 'appointment_id' });

User.hasMany(Notification, { foreignKey: 'recipient_user_id' });
Notification.belongsTo(User, { foreignKey: 'recipient_user_id' });

module.exports = {
  sequelize,
  User,
  Doctor,
  DoctorLeave,
  Appointment,
  SymptomSummary,
  PostVisitSummary,
  Notification,
};
