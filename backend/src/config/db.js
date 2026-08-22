const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const storagePath = process.env.DB_STORAGE_PATH || './data/healthcare.sqlite';
const dir = path.dirname(storagePath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// SQLite is used by default so the project runs with zero external DB setup
// (ideal for local dev and grading). Swapping to Postgres/MySQL only requires
// changing `dialect` + connection options here - the models/queries are
// written in plain Sequelize and are portable across dialects.
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: storagePath,
  logging: process.env.NODE_ENV === 'development' ? false : false,
  define: {
    underscored: true,
  },
});

module.exports = sequelize;
