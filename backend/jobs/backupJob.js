import cron from 'node-cron';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { EJSON } from 'bson';
import { config } from '../config/config.js';

/**
 * Daily backup at 5:00 AM IST (point 13).
 * Writes every collection as gzipped Extended JSON into BACKUP_DIR/YYYY-MM-DD/.
 * Restore with: npm run restore -- 2026-11-12
 * In production also point BACKUP_DIR at a mounted disk or sync it to S3,
 * and keep MongoDB Atlas' own snapshots switched on.
 */
export const runBackup = async () => {
  const stamp = new Date().toLocaleDateString('en-CA', { timeZone: config.TIMEZONE });
  const dir = path.resolve(config.BACKUP_DIR, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const cols = await mongoose.connection.db.listCollections().toArray();
  let docs = 0;
  for (const { name } of cols) {
    const all = await mongoose.connection.db.collection(name).find({}).toArray();
    docs += all.length;
    fs.writeFileSync(path.join(dir, `${name}.json.gz`), zlib.gzipSync(EJSON.stringify(all, { relaxed: false })));
  }
  // prune old backups
  const keepAfter = Date.now() - config.BACKUP_KEEP_DAYS * 86400000;
  for (const d of fs.readdirSync(path.resolve(config.BACKUP_DIR))) {
    const t = Date.parse(d);
    if (!Number.isNaN(t) && t < keepAfter) fs.rmSync(path.resolve(config.BACKUP_DIR, d), { recursive: true, force: true });
  }
  console.log(`💾 Backup ${stamp}: ${cols.length} collections, ${docs} documents`);
  return { dir, collections: cols.length, documents: docs };
};

export const scheduleBackup = () =>
  cron.schedule(config.BACKUP_CRON, () => runBackup().catch((e) => console.error('Backup failed', e)), {
    timezone: config.TIMEZONE,
  });
