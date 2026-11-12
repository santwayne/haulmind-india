import mongoose from 'mongoose';
import { Branch } from '../models/masterModels.js';
import { MoneyAccount, CashEntry, AccountHead, DEFAULT_HEADS } from '../models/financeModels.js';
import { AppError } from '../utils/http.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const oid = (x) => new mongoose.Types.ObjectId(String(x));

/** Every branch gets its own cash box automatically */
export const cashAccountFor = async (branchId) => {
  let acc = await MoneyAccount.findOne({ branch: branchId, type: 'cash', active: { $ne: false } }).sort({ isDefault: -1, createdAt: 1 });
  if (!acc) {
    const b = await Branch.findById(branchId).select('name code');
    if (!b) throw new AppError(400, 'Branch not found');
    acc = await MoneyAccount.create({ name: `Cash – ${b.name}`, type: 'cash', branch: b._id, isDefault: true });
  }
  return acc;
};

/** Default bank: branch's own default bank → company-level default bank → auto-created "Main bank account" */
export const bankAccountFor = async (branchId) => {
  let acc =
    (branchId && (await MoneyAccount.findOne({ branch: branchId, type: 'bank', active: { $ne: false } }).sort({ isDefault: -1, createdAt: 1 }))) ||
    (await MoneyAccount.findOne({ branch: null, type: 'bank', active: { $ne: false } }).sort({ isDefault: -1, createdAt: 1 }));
  if (!acc) acc = await MoneyAccount.create({ name: 'Main bank account', type: 'bank', isDefault: true });
  return acc;
};

/** Pick the money account: explicit id wins, else cash box for cash, else default bank */
export const resolveAccount = async ({ accountId, branchId, mode = 'cash' }) => {
  if (accountId) {
    const a = await MoneyAccount.findById(accountId);
    if (!a || a.active === false) throw new AppError(400, 'Selected cash/bank account not found');
    return a;
  }
  return mode === 'cash' ? cashAccountFor(branchId) : bankAccountFor(branchId);
};

export const postCash = async ({ accountId, branchId, mode, direction, amount, category, date, ...rest }) => {
  const amt = r2(amount);
  if (amt <= 0) return null;
  const account = await resolveAccount({ accountId, branchId, mode });
  return CashEntry.create({ account: account._id, branch: branchId || account.branch, direction, amount: amt, category, date: date || new Date(), ...rest });
};

/** Undo every live cash entry for a document (LR cancel, receipt cancel …) */
export const reverseCash = async ({ refType, refId, userId, narration }) => {
  const live = await CashEntry.find({ refType, refId, reversed: false, category: { $ne: 'reversal' } });
  for (const e of live) {
    await CashEntry.create({
      account: e.account, branch: e.branch, date: new Date(), direction: e.direction === 'in' ? 'out' : 'in',
      amount: e.amount, category: 'reversal', reversalCategory: e.category, head: e.head, party: e.party, broker: e.broker,
      refType, refId, ref: e.ref, narration: narration || `Reversal of ${e.ref || e.category}`, reversalOf: e._id, createdBy: userId,
    });
    e.reversed = true;
    await e.save();
  }
  return live.length;
};

/** Balance of each money account (optionally only some) */
export const accountBalances = async (accountIds) => {
  const match = accountIds ? { account: { $in: accountIds.map(oid) } } : {};
  const agg = await CashEntry.aggregate([
    { $match: match },
    { $group: { _id: '$account', in: { $sum: { $cond: [{ $eq: ['$direction', 'in'] }, '$amount', 0] } }, out: { $sum: { $cond: [{ $eq: ['$direction', 'out'] }, '$amount', 0] } } } },
  ]);
  return Object.fromEntries(agg.map((a) => [String(a._id), { in: r2(a.in), out: r2(a.out) }]));
};

export const ensureDefaultHeads = async () => {
  for (const [kind, names] of Object.entries(DEFAULT_HEADS)) {
    for (const name of names) await AccountHead.updateOne({ name, kind }, { $setOnInsert: { name, kind } }, { upsert: true });
  }
};
