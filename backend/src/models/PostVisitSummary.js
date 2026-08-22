const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class PostVisitSummary extends Model {}

// Doctor's raw clinical notes + prescription + LLM-generated patient-friendly summary
PostVisitSummary.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    appointment_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    clinical_notes: { type: DataTypes.TEXT, allowNull: false },
    diagnosis: { type: DataTypes.STRING, allowNull: true },
    // Structured prescription: [{ drug, dosage, frequency_per_day, times: ["08:00","20:00"], duration_days, notes }]
    prescription: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
    follow_up_date: { type: DataTypes.DATEONLY, allowNull: true },
    // LLM output
    patient_summary: { type: DataTypes.TEXT, allowNull: true },
    medication_schedule_text: { type: DataTypes.TEXT, allowNull: true },
    follow_up_steps: { type: DataTypes.JSON, allowNull: true },
    llm_status: {
      type: DataTypes.ENUM('pending', 'success', 'failed', 'fallback'),
      allowNull: false,
      defaultValue: 'pending',
    },
    llm_error: { type: DataTypes.TEXT, allowNull: true },
  },
  { sequelize, modelName: 'PostVisitSummary', tableName: 'post_visit_summaries' }
);

module.exports = PostVisitSummary;
