import 'dotenv/config';

// Every date in this app is Indian time: LR / bill dates on PDFs, "today" on the dashboard,
// date filters, and the financial year in LR numbers (1 April 00:00 IST). Servers (EC2) run
// on UTC, so without this an LR booked at 2 AM IST printed the previous day.
// Node re-reads TZ when it changes, so setting it here (before any request) is enough.
process.env.TZ = process.env.TZ || 'Asia/Kolkata';

export const config = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/haulmind_india',
  JWT_SECRET: process.env.JWT_SECRET || 'change-this-secret',
  JWT_EXPIRES: process.env.JWT_EXPIRES || '12h',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  TIMEZONE: process.env.TZ_NAME || 'Asia/Kolkata',
  PRODUCT_NAME: 'HaulMind India',
  // The transport company using this install (printed on LR, challan, DC, messages)
  COMPANY_NAME: process.env.COMPANY_NAME || 'TCL Logistics',
  PUBLIC_TRACK_URL: process.env.PUBLIC_TRACK_URL || 'http://localhost:5173/track',
  // Notifications: provider = "log" (default, dev), "whatsapp" (Meta Cloud API), "msg91" (SMS)
  NOTIFY_PROVIDER: process.env.NOTIFY_PROVIDER || 'log',
  WA_TOKEN: process.env.WA_TOKEN,
  WA_PHONE_ID: process.env.WA_PHONE_ID,
  WA_LANG: process.env.WA_LANG || 'hi',
  MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY,
  MSG91_SENDER: process.env.MSG91_SENDER,
  BACKUP_DIR: process.env.BACKUP_DIR || './backups',
  BACKUP_CRON: process.env.BACKUP_CRON || '0 5 * * *', // every day 5:00 AM IST
  BACKUP_KEEP_DAYS: Number(process.env.BACKUP_KEEP_DAYS || 30),
  // Optional: copy each night's backup off this server, e.g.
  //   aws s3 sync ./backups s3://YOUR-BUCKET/haulmind-tcl --only-show-errors
  BACKUP_SYNC_CMD: process.env.BACKUP_SYNC_CMD || '',
  // Branch cash box may not go below zero (bank can). true = allow, e.g. while opening balances are pending
  ALLOW_NEGATIVE_CASH: process.env.ALLOW_NEGATIVE_CASH === 'true',
  REMINDER_CRON: process.env.REMINDER_CRON || '30 10 * * *', // daily 10:30 AM IST check
  REMINDER_EVERY_DAYS: Number(process.env.REMINDER_EVERY_DAYS || 15),
};
