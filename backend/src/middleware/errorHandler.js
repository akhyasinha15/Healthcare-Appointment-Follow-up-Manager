const { ValidationError, UniqueConstraintError } = require('sequelize');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[error]', err);

  if (err instanceof UniqueConstraintError) {
    return res.status(409).json({ error: 'Conflict: that slot was just taken. Please pick another.' });
  }
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.errors.map((e) => e.message).join(', ') });
  }
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Internal server error' });
}

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

module.exports = { errorHandler, AppError };
