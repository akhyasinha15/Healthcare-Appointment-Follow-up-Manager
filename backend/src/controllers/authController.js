const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { AppError } = require('../middleware/errorHandler');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function sanitize(user) {
  const { id, name, email, role, phone } = user;
  return { id, name, email, role, phone };
}

// Public: patient self-registration only. Doctor/admin accounts are created by an admin.
async function registerPatient(req, res) {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) throw new AppError('name, email and password are required');

  const existing = await User.findOne({ where: { email } });
  if (existing) throw new AppError('Email already registered', 409);

  const password_hash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, password_hash, phone, role: 'patient' });

  res.status(201).json({ user: sanitize(user), token: signToken(user) });
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError('email and password are required');

  const user = await User.findOne({ where: { email } });
  if (!user) throw new AppError('Invalid credentials', 401);

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) throw new AppError('Invalid credentials', 401);
  if (!user.is_active) throw new AppError('Account is deactivated', 403);

  res.json({ user: sanitize(user), token: signToken(user) });
}

async function me(req, res) {
  res.json({ user: sanitize(req.user) });
}

module.exports = { registerPatient, login, me, sanitize, signToken };
