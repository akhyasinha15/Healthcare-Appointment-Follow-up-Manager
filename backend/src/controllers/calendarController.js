const calendarService = require('../services/calendarService');

// In this reference implementation, refresh tokens are logged rather than persisted
// to keep the schema focused on the core booking domain - see README "Known
// simplifications" for the one-line change needed to persist them per-user.
async function getAuthUrl(req, res) {
  const url = calendarService.getAuthUrl(req.user.id);
  res.json({ url });
}

async function oauthCallback(req, res) {
  const { code, state } = req.query;
  const tokens = await calendarService.exchangeCodeForTokens(code);
  console.log(`[calendarController] received tokens for user ${state}:`, Object.keys(tokens));
  res.send('Google Calendar connected. You can close this window.');
}

module.exports = { getAuthUrl, oauthCallback };
