import http from 'http';
import { app } from './app.js';
import { config } from './config/config.js';
import { connectDB } from './config/mongoConnection.js';
import { scheduleBackup } from './jobs/backupJob.js';
import { scheduleReminders } from './jobs/reminderJob.js';
import { ensureDefaultHeads } from './services/financeService.js';
import { Notification } from './models/systemModels.js';

const start = async () => {
  // Never run in production with the built-in fallback secret: anyone who knows it could
  // make a login token for any user. deploy/setup-ec2.sh writes a random one into .env.
  if (config.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-this-secret' || process.env.JWT_SECRET.length < 32)) {
    throw new Error('JWT_SECRET is missing or too short in backend/.env (needs 32+ random characters, e.g. `openssl rand -hex 32`)');
  }
  if (!config.PUBLIC_TRACK_URL) {
    console.warn('⚠️  PUBLIC_TRACK_URL is not set to the real domain in backend/.env – WhatsApp/SMS will go WITHOUT a tracking link. Set e.g. PUBLIC_TRACK_URL=https://haulmindin.wayneesolutions.com/track');
  }
  if (!['whatsapp', 'msg91'].includes(config.NOTIFY_PROVIDER)) {
    console.warn(`⚠️  NOTIFY_PROVIDER=${config.NOTIFY_PROVIDER}: WhatsApp/SMS are only logged, nobody receives them.`);
  }
  if (config.NOTIFY_PROVIDER === 'whatsapp') {
    if (!config.WA_VERIFY_TOKEN) console.warn('⚠️  WA_VERIFY_TOKEN is empty – Meta cannot verify the webhook /api/v1/webhooks/whatsapp (no delivered/read status, no replies).');
    if (!config.WA_APP_SECRET) console.warn('⚠️  WA_APP_SECRET is empty – WhatsApp webhook calls are accepted WITHOUT signature check. Set it from Meta app → Settings → Basic → App secret.');
  }
  await connectDB();
  await ensureDefaultHeads();
  // Earlier builds saved "log"-mode messages as "sent". They were never delivered – correct them once.
  const fixed = await Notification.updateMany({ channel: 'log', status: 'sent' }, { status: 'logged' });
  if (fixed.modifiedCount) console.log(`📨 ${fixed.modifiedCount} old log-only messages re-marked as "logged" (not sent)`);
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
