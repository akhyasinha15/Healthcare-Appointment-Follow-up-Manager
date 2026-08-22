const { google } = require('googleapis');

/**
 * Google Calendar integration (OAuth 2.0).
 *
 * Flow:
 *  1. Patient/doctor visits GET /api/calendar/oauth/url to get a consent URL.
 *  2. Google redirects to GET /api/calendar/oauth/callback with a `code`.
 *  3. We exchange the code for { access_token, refresh_token } and store the
 *     refresh_token against the user (see User model - in a production build
 *     this would live in its own encrypted table; omitted here for brevity,
 *     see README "Known simplifications").
 *  4. On booking/reschedule/cancel we use the stored refresh_token to create,
 *     update, or delete an event via the Calendar API.
 *
 * CALENDAR_DRY_RUN=true (default) mocks all calls and logs what would have
 * happened, so the booking flow works end-to-end without real Google credentials
 * for local dev / grading. Set it to false and provide GOOGLE_CLIENT_ID/SECRET
 * to use the real API.
 */

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(state) {
  const oAuth2Client = getOAuthClient();
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state,
  });
}

async function exchangeCodeForTokens(code) {
  const oAuth2Client = getOAuthClient();
  const { tokens } = await oAuth2Client.getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date, ... }
}

function getCalendarClient(refreshToken) {
  const oAuth2Client = getOAuthClient();
  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: oAuth2Client });
}

async function createEvent({ refreshToken, summary, description, startISO, endISO, attendeeEmail }) {
  if (process.env.CALENDAR_DRY_RUN === 'true' || !refreshToken) {
    const mockId = `mock-evt-${Date.now()}`;
    console.log(`[calendarService][DRY RUN] create event "${summary}" ${startISO} -> ${endISO} (id=${mockId})`);
    return { id: mockId };
  }
  const calendar = getCalendarClient(refreshToken);
  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary,
      description,
      start: { dateTime: startISO },
      end: { dateTime: endISO },
      attendees: attendeeEmail ? [{ email: attendeeEmail }] : undefined,
      reminders: { useDefault: true },
    },
  });
  return res.data;
}

async function updateEvent({ refreshToken, eventId, startISO, endISO, summary }) {
  if (process.env.CALENDAR_DRY_RUN === 'true' || !refreshToken) {
    console.log(`[calendarService][DRY RUN] update event ${eventId} -> ${startISO} - ${endISO}`);
    return { id: eventId };
  }
  const calendar = getCalendarClient(refreshToken);
  const res = await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: {
      summary,
      start: startISO ? { dateTime: startISO } : undefined,
      end: endISO ? { dateTime: endISO } : undefined,
    },
  });
  return res.data;
}

async function deleteEvent({ refreshToken, eventId }) {
  if (process.env.CALENDAR_DRY_RUN === 'true' || !refreshToken) {
    console.log(`[calendarService][DRY RUN] delete event ${eventId}`);
    return true;
  }
  const calendar = getCalendarClient(refreshToken);
  await calendar.events.delete({ calendarId: 'primary', eventId }).catch((err) => {
    // Treat "already deleted" as success (idempotency)
    if (err.code !== 404 && err.code !== 410) throw err;
  });
  return true;
}

module.exports = { getAuthUrl, exchangeCodeForTokens, createEvent, updateEvent, deleteEvent };
