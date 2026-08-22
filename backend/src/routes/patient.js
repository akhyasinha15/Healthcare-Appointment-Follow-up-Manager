const router = require('express').Router();
const ctrl = require('../controllers/patientController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/doctors', authenticate, ctrl.searchDoctors);
router.get('/me/appointments', authenticate, authorize('patient'), ctrl.myAppointments);

module.exports = router;
