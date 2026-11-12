import http from 'http';
import { app } from './app.js';
import { config } from './config/config.js';
import { connectDB } from './config/mongoConnection.js';
import { scheduleBackup } from './jobs/backupJob.js';
import { scheduleReminders } from './jobs/reminderJob.js';
import { ensureDefaultHeads } from './services/financeService.js';

const start = async () => {
  await connectDB();
  await ensureDefaultHeads();
  scheduleBackup();
  scheduleReminders();
  http.createServer(app).listen(config.PORT, '0.0.0.0', () => {
    console.log(`✅ ${config.PRODUCT_NAME} API (${config.COMPANY_NAME}) on http://localhost:${config.PORT}`);
    console.log(`💾 Daily backup scheduled: "${config.BACKUP_CRON}" (${config.TIMEZONE})`);
  });
};

start().catch((e) => {
  console.error('Failed to start', e);
  process.exit(1);
});
