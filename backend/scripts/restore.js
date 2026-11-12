/**
 * Restore a daily backup made by jobs/backupJob.js
 *   npm run restore -- 2026-11-12            (asks for confirmation)
 *   npm run restore -- 2026-11-12 --yes      (no question – for scripts)
 * Every collection found in BACKUP_DIR/<date>/ is REPLACED with the backup copy.
 * Restore into a different database first if unsure:  MONGO_URI=.../haulmind_check npm run restore -- <date>
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import readline from 'readline/promises';
import mongoose from 'mongoose';
import { EJSON } from 'bson';
import { config } from '../config/config.js';
import { connectDB } from '../config/mongoConnection.js';

const [date, flag] = process.argv.slice(2);
const dir = path.resolve(config.BACKUP_DIR, date || '');
if (!date || !fs.existsSync(dir)) {
  const have = fs.existsSync(path.resolve(config.BACKUP_DIR)) ? fs.readdirSync(path.resolve(config.BACKUP_DIR)).sort().slice(-10) : [];
  console.error(`Usage: npm run restore -- <date>\nAvailable: ${have.join(', ') || 'none in ' + config.BACKUP_DIR}`);
  process.exit(1);
}
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz'));
const dbName = new URL(config.MONGO_URI.replace('mongodb+srv://', 'https://').replace('mongodb://', 'http://')).pathname.slice(1) || '(default)';
if (flag !== '--yes') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`Replace ${files.length} collections in database "${dbName}" with the backup of ${date}? Type YES: `);
  rl.close();
  if (a !== 'YES') { console.log('Cancelled'); process.exit(0); }
}
await connectDB();
const db = mongoose.connection.db;
let docs = 0;
for (const f of files) {
  const name = f.replace(/\.json\.gz$/, '');
  const rows = EJSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString(), { relaxed: false });
  await db.collection(name).deleteMany({});
  if (rows.length) await db.collection(name).insertMany(rows, { ordered: false });
  docs += rows.length;
  console.log(`  ${name}: ${rows.length}`);
}
console.log(`✅ Restored ${files.length} collections, ${docs} documents from ${date}`);
await mongoose.disconnect();
