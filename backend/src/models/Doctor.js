const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class Doctor extends Model {}

// Doctor profile - 1:1 with a User (role = doctor). Admin manages this.
Doctor.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    user_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    specialisation: { type: DataTypes.STRING, allowNull: false },
    slot_duration_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
    // Weekly recurring working hours, e.g.
    // { "mon": [["09:00","13:00"],["14:00","17:00"]], "tue": [...], ... }
    working_hours: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    bio: { type: DataTypes.TEXT, allowNull: true },
    consultation_fee: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  },
  { sequelize, modelName: 'Doctor', tableName: 'doctors' }
);

module.exports = Doctor;
