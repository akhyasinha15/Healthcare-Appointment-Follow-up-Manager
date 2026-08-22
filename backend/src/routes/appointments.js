const router = require('express').Router();
const ctrl = require('../controllers/appointmentController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/doctors/:doctorId/slots', authenticate, ctrl.getSlots);
router.post('/hold', authenticate, authorize('patient'), ctrl.hold);
router.post('/:appointmentId/confirm', authenticate, authorize('patient'), ctrl.confirm);
router.post('/:appointmentId/cancel', authenticate, authorize('patient', 'doctor', 'admin'), ctrl.cancel);

module.exports = router;
