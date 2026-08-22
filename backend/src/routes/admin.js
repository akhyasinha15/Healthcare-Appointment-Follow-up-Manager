const router = require('express').Router();
const ctrl = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('admin'));

router.post('/doctors', ctrl.createDoctor);
router.get('/doctors', ctrl.listDoctors);
router.patch('/doctors/:doctorId', ctrl.updateDoctor);
router.delete('/doctors/:doctorId', ctrl.deactivateDoctor);

router.post('/doctors/:doctorId/leaves', ctrl.createLeave);
router.get('/doctors/:doctorId/leaves', ctrl.listLeaves);

module.exports = router;
