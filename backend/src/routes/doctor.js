const router = require('express').Router();
const ctrl = require('../controllers/doctorController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('doctor'));

router.get('/me/profile', ctrl.getMyProfile);
router.get('/me/appointments', ctrl.myAppointments);
router.post('/appointments/:appointmentId/post-visit', ctrl.submitPostVisit);

module.exports = router;
