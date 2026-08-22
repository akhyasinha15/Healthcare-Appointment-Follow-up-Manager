const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db');

class SymptomSummary extends Model {}

// Patient-submitted symptom form + LLM-generated pre-visit summary (1:1 with appointment)
SymptomSummary.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    appointment_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    raw_symptoms: { type: DataTypes.TEXT, allowNull: false },
    duration_days: { type: DataTypes.INTEGER, allowNull: true },
    // LLM output
    urgency_level: { type: DataTypes.ENUM('Low', 'Medium', 'High'), allowNull: true },
    chief_complaint: { type: DataTypes.STRING, allowNull: true },
    suggested_questions: { type: DataTypes.JSON, allowNull: true }, // array of 3 strings
    llm_status: {
      type: DataTypes.ENUM('pending', 'success', 'failed', 'fallback'),
      allowNull: false,
      defaultValue: 'pending',
    },
    llm_error: { type: DataTypes.TEXT, allowNull: true },
    llm_raw_response: { type: DataTypes.TEXT, allowNull: true },
  },
  { sequelize, modelName: 'SymptomSummary', tableName: 'symptom_summaries' }
);

module.exports = SymptomSummary;
