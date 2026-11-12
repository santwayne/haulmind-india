/**
 * First-time setup. Creates the two hubs, a few sample branches, sample route rates
 * and the owner login. Safe to run twice (skips what exists).
 *   SEED_OWNER_PASSWORD=xxxx npm run seed
 * Replace the sample branches with TCL's real list before go-live.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { connectDB } from '../config/mongoConnection.js';
import { Branch, RouteRate } from '../models/masterModels.js';
import { User } from '../models/userModel.js';
import { ensureDefaultHeads } from '../services/financeService.js';

export const BRANCHES = [
  { code: 'LDH', name: 'Ludhiana Hub', type: 'hub', city: 'Ludhiana', state: 'Punjab' },
  { code: 'TPR', name: 'Tiruppur Hub', type: 'hub', city: 'Tiruppur', state: 'Tamil Nadu' },
  { code: 'JAL', name: 'Jalandhar', city: 'Jalandhar', state: 'Punjab', hub: 'LDH' },
  { code: 'ASR', name: 'Amritsar', city: 'Amritsar', state: 'Punjab', hub: 'LDH' },
  { code: 'CBE', name: 'Coimbatore', city: 'Coimbatore', state: 'Tamil Nadu', hub: 'TPR' },
  { code: 'COK', name: 'Kochi', city: 'Kochi', state: 'Kerala', hub: 'TPR' },
];

export const seed = async ({ ownerPassword, quiet } = {}) => {
  const byCode = {};
  for (const b of BRANCHES) {
    const doc = await Branch.findOneAndUpdate(
      { code: b.code },
      { $setOnInsert: { name: b.name, type: b.type || 'branch', city: b.city, state: b.state } },
      { upsert: true, returnDocument: 'after' }
    );
    byCode[b.code] = doc;
  }
  for (const b of BRANCHES.filter((x) => x.hub)) {
    await Branch.updateOne({ _id: byCode[b.code]._id }, { parentHub: byCode[b.hub]._id });
  }
  // sample rates hub ↔ hub and hub → branch (₹/kg)
  const rates = [['TPR', 'LDH', 6], ['LDH', 'TPR', 6], ['TPR', 'JAL', 7], ['TPR', 'ASR', 7.5], ['LDH', 'COK', 7.5], ['LDH', 'CBE', 6.5]];
  for (const [f, t, perKg] of rates) {
    await RouteRate.updateOne(
      { fromBranch: byCode[f]._id, toBranch: byCode[t]._id },
      { $setOnInsert: { perKg, perNag: 0, minFreight: 300, biltyCharge: 50 } },
      { upsert: true }
    );
  }
  await ensureDefaultHeads();
  let password = null;
  if (!(await User.exists({ role: 'owner' }))) {
    password = ownerPassword || process.env.SEED_OWNER_PASSWORD || crypto.randomBytes(6).toString('base64url');
    await User.create({ name: 'Owner', username: 'owner', password, role: 'owner', branches: [] });
    if (!quiet) console.log(`👤 Owner login → username: owner   password: ${password}   (change it after first login)`);
  }
  if (!quiet) console.log(`🏢 ${BRANCHES.length} branches ready`);
  return { byCode, ownerPassword: password };
};

if (process.argv[1]?.endsWith('seed.js')) {
  await connectDB();
  await seed();
  await mongoose.disconnect();
}
