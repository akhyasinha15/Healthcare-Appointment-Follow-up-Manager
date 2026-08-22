require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const patientRoutes = require('./routes/patient');
const appointmentRoutes = require('./routes/appointments');
const doctorRoutes = require('./routes/doctor');
const calendarRoutes = require('./routes/calendar');

const app = express();

// The bundled reference frontend (patient/doctor/admin HTML) uses small inline
// <script> blocks for simplicity instead of separate bundled JS files, so the
// default Helmet CSP (which blocks all inline scripts) needs to explicitly
// allow 'unsafe-inline' for scripts served by this app. If you replace the
// frontend with a build step (webpack/vite) that emits external .js files,
// you can remove 'unsafe-inline' from scriptSrc for a stricter policy.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", "'unsafe-inline'"],
      },
    },
  })
);
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

// Serve the minimal static frontend
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/calendar', calendarRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
