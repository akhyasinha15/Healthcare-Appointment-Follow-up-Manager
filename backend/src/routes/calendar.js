const router = require('express').Router();
const ctrl = require('../controllers/calendarController');
const { authenticate } = require('../middleware/auth');

router.get('/oauth/url', authenticate, ctrl.getAuthUrl);
router.get('/oauth/callback', ctrl.oauthCallback);

module.exports = router;
