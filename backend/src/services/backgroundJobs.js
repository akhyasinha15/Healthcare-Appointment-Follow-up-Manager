const cron = require('node-cron');
const { releaseExpiredHolds } = require('./appointmentService');
const { retryFailedNotifications } = require('./notificationService');

function startBackgroundJobs() {
  const expr = process.env.REMINDER_CRON || '*/10 * * * *';

  cron.schedule(expr, async () => {
    try {
      await releaseExpiredHolds();
      await retryFailedNotifications();
    } catch (err) {
      console.error('[backgroundJobs] sweep failed:', err);
    }
  });

  console.log(`[backgroundJobs] scheduled sweep with cron "${expr}"`);
}

module.exports = { startBackgroundJobs };
