import http from 'http';
import { app } from './app.js';
import { config } from './config/config.js';
import { connectDB } from './config/mongoConnection.js';
import { scheduleBackup } from './jobs/backupJob.js';
import { scheduleReminders } from './jobs/reminderJob.js';
import { ensureDefaultHeads } from './services/financeService.js';

const start = async () => {
  // Never run in production with the built-in fallback secret: anyone who knows it could
  // make a login token for any user. deploy/setup-ec2.sh writes a random one into .env.
  if (config.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-this-secret' || process.env.JWT_SECRET.length < 32)) {
    throw new Error('JWT_SECRET is missing or too short in backend/.env (needs 32+ random characters, e.g. `openssl rand -hex 32`)');
  }
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
