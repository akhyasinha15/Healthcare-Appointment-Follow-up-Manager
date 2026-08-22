const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class Appointment extends Model {}

/*
 * Double-booking prevention strategy (see also SYSTEM_DESIGN.md):
 *  1. DB-level unique composite index on (doctor_id, slot_start, status_group) is
 *     approximated here via a unique index on (doctor_id, slot_start) for any row
 *     whose status is 'held' or 'confirmed' - enforced in the service layer using
 *     a serializable transaction + unique index (see migrations / sync below),
 *     so even concurrent requests hitting the DB at the same instant collide on
 *     the unique constraint and only one wins.
 *  2. A short-lived "hold" (status='held', hold_expires_at=now+TTL) is created first
 *     while the patient fills the symptom form; if not confirmed before it expires,
 *     a background sweep releases it so the slot becomes bookable again.
 */
Appointment.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    patient_id: { type: DataTypes.UUID, allowNull: false },
    doctor_id: { type: DataTypes.UUID, allowNull: false },
    slot_start: { type: DataTypes.DATE, allowNull: false }, // exact UTC timestamp of appointment start
    slot_end: { type: DataTypes.DATE, allowNull: false },
    status: {
      type: DataTypes.ENUM('held', 'confirmed', 'cancelled', 'completed', 'no_show'),
      allowNull: false,
      defaultValue: 'held',
    },
    hold_expires_at: { type: DataTypes.DATE, allowNull: true },
    cancelled_reason: { type: DataTypes.STRING, allowNull: true },
    cancelled_by: { type: DataTypes.UUID, allowNull: true },
    google_calendar_event_id_patient: { type: DataTypes.STRING, allowNull: true },
    google_calendar_event_id_doctor: { type: DataTypes.STRING, allowNull: true },
  },
  {
    sequelize,
    modelName: 'Appointment',
    tableName: 'appointments',
    indexes: [
      // Prevents two active (held/confirmed) appointments for the same doctor+slot.
      // SQLite honors unique indexes on nullable/conditional columns via a partial index.
      {
        name: 'uniq_doctor_slot_active',
        unique: true,
        fields: ['doctor_id', 'slot_start'],
        where: { status: ['held', 'confirmed'] },
      },
      { fields: ['patient_id'] },
      { fields: ['doctor_id', 'slot_start'] },
    ],
  }
);

module.exports = Appointment;
