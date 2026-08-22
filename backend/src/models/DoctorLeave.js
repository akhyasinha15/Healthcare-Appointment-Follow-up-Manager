const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class DoctorLeave extends Model {}

// A leave record blocks a doctor's slots for [start_date, end_date] (inclusive, whole days).
// When created, the system must find overlapping CONFIRMED appointments and notify patients.
DoctorLeave.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    doctor_id: { type: DataTypes.UUID, allowNull: false },
    start_date: { type: DataTypes.DATEONLY, allowNull: false },
    end_date: { type: DataTypes.DATEONLY, allowNull: false },
    reason: { type: DataTypes.STRING, allowNull: true },
    created_by: { type: DataTypes.UUID, allowNull: true }, // admin user id
  },
  { sequelize, modelName: 'DoctorLeave', tableName: 'doctor_leaves' }
);

module.exports = DoctorLeave;
