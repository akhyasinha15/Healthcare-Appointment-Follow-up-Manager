const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class Notification extends Model {}

/*
 * Every outbound email is recorded here BEFORE sending is attempted (outbox pattern).
 * This gives us an audit trail and a durable retry queue: if the process crashes
 * mid-send, the background job simply picks up rows still in 'pending'/'failed'
 * state on its next sweep instead of losing the notification.
 */
Notification.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    type: {
      type: DataTypes.ENUM(
        'booking_confirmation',
        'reminder_appointment',
        'reminder_medication',
        'cancellation',
        'reschedule',
        'leave_conflict'
      ),
      allowNull: false,
    },
    channel: { type: DataTypes.ENUM('email', 'calendar'), allowNull: false, defaultValue: 'email' },
    recipient_user_id: { type: DataTypes.UUID, allowNull: false },
    recipient_email: { type: DataTypes.STRING, allowNull: true },
    appointment_id: { type: DataTypes.UUID, allowNull: true },
    subject: { type: DataTypes.STRING, allowNull: true },
    body: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM('pending', 'sent', 'failed', 'abandoned'),
      allowNull: false,
      defaultValue: 'pending',
    },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    last_error: { type: DataTypes.TEXT, allowNull: true },
    scheduled_for: { type: DataTypes.DATE, allowNull: true }, // for future-dated reminders
    sent_at: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, modelName: 'Notification', tableName: 'notifications' }
);

module.exports = Notification;
