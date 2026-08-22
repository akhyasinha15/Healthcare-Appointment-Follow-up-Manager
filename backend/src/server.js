const app = require('./app');
const { sequelize } = require('./models');
const { startBackgroundJobs } = require('./services/backgroundJobs');

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await sequelize.authenticate();
    // Creates tables if they don't exist yet (non-destructive). Run `npm run
    // seed` once to both create the schema and load demo data; for production,
    // replace this with proper Sequelize migrations (see README).
    await sequelize.sync();
    console.log('[db] connected & synced');

    startBackgroundJobs();

    app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
  } catch (err) {
    console.error('[server] failed to start:', err);
    process.exit(1);
  }
}

start();
