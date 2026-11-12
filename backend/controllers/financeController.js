import mongoose from 'mongoose';
import { LR } from '../models/lrModel.js';
import { Challan } from '../models/challanModel.js';
import { Branch, Party, Broker } from '../models/masterModels.js';
import { Bill, LedgerEntry } from '../models/accountsModels.js';
import { Claim } from '../models/systemModels.js';
import { MoneyAccount, CashEntry, AccountHead } from '../models/financeModels.js';
import { ah, ok, AppError, sendPdf, paginate } from '../utils/http.js';
import { assertBranch } from '../middleware/authRoles.js';
import { nextNumber } from '../services/numbering.js';
import { audit } from '../services/auditService.js';
import { postCash, reverseCash, resolveAccount, accountBalances, cashAccountFor } from '../services/financeService.js';
import { cashBookPdf, pnlPdf } from '../services/pdfService.js';

const oid = (x) => new mongoose.Types.ObjectId(String(x));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const TZ = 'Asia/Kolkata';
// Indian financial year start for a date (1 April)
const fyStart = (d = new Date()) => new Date(d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1, 3, 1);
const range = (q) => {
  const start = q.from ? new Date(new Date(q.from).setHours(0, 0, 0, 0)) : fyStart();
  const end = q.to ? new Date(new Date(q.to).setHours(23, 59, 59, 999)) : new Date(new Date().setHours(23, 59, 59, 999));
  return { start, end };
};
const visibleIds = (req) => {
  if (req.query.branch) { assertBranch(req, req.query.branch); return [oid(req.query.branch)]; }
  return req.allBranches ? null : req.branchIds.map(oid);
};

// ═════════════════════ MONEY ACCOUNTS & HEADS ═════════════════════════════

export const listMoneyAccounts = ah(async (req, res) => {
  // make sure every visible branch has its cash box
  const branches = await Branch.find(req.allBranches ? { active: { $ne: false } } : { _id: { $in: req.branchIds } }).select('_id');
  for (const b of branches) await cashAccountFor(b._id);
  const filter = { active: { $ne: false } };
  if (!req.allBranches) filter.$or = [{ branch: { $in: req.branchIds } }, { branch: null }];
  const items = (await MoneyAccount.find(filter).populate('branch', 'name code type').lean())
    // cash first, hubs first, then by name
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'cash' ? -1 : 1) || (a.branch?.type === 'hub' ? 0 : 1) - (b.branch?.type === 'hub' ? 0 : 1) || a.name.localeCompare(b.name));
  const bal = await accountBalances(items.map((i) => i._id));
  ok(res, {
    items: items.map((a) => {
      const x = bal[String(a._id)] || { in: 0, out: 0 };
      return { ...a, totalIn: x.in, totalOut: x.out, balance: r2((a.openingBalance || 0) + x.in - x.out) };
    }),
  });
});

export const saveMoneyAccount = ah(async (req, res) => {
  const b = req.body || {};
  if (b.branch) assertBranch(req, b.branch);
  const data = { name: b.name, type: b.type, branch: b.branch || null, bankName: b.bankName, accountLabel: b.accountLabel, openingBalance: Number(b.openingBalance) || 0, openingDate: b.openingDate, isDefault: !!b.isDefault, active: b.active !== false };
  if (data.accountLabel && /\d{6,}/.test(data.accountLabel)) data.accountLabel = data.accountLabel.replace(/\d(?=\d{4})/g, '•'); // keep only last 4 digits
  let acc;
  if (req.params.id) {
    const before = await MoneyAccount.findById(req.params.id).lean();
    if (!before) throw new AppError(404, 'Account not found');
    acc = await MoneyAccount.findByIdAndUpdate(req.params.id, data, { returnDocument: 'after', runValidators: true });
    await audit(req, { action: 'update', entity: 'MoneyAccount', entityId: acc._id, ref: acc.name, before, after: acc.toObject() });
  } else {
    if (!data.name || !data.type) throw new AppError(400, 'Name and type are required');
    acc = await MoneyAccount.create(data);
    await audit(req, { action: 'create', entity: 'MoneyAccount', entityId: acc._id, ref: acc.name, changes: { type: acc.type, opening: acc.openingBalance } });
  }
  if (acc.isDefault) await MoneyAccount.updateMany({ _id: { $ne: acc._id }, branch: acc.branch, type: acc.type }, { isDefault: false });
  ok(res, acc, 'Saved', req.params.id ? 200 : 201);
});

export const listHeads = ah(async (req, res) => {
  const items = await AccountHead.find({ active: { $ne: false }, ...(req.query.kind && { kind: req.query.kind }) }).sort({ kind: 1, name: 1 }).lean();
  ok(res, { items });
});
export const createHead = ah(async (req, res) => {
  const h = await AccountHead.create({ name: req.body?.name, kind: req.body?.kind || 'expense' });
  ok(res, h, 'Head added', 201);
});

// ═════════════════════ VOUCHERS (expense / income / contra) ════════════════

/**
 * Body: { type: 'expense'|'income'|'contra', branch, date?, amount, head?, mode?, account?, toAccount?, narration?, paidTo? }
 * contra = move money between two accounts (cash deposited in bank, cash withdrawn …)
 */
export const createVoucher = ah(async (req, res) => {
  const b = req.body || {};
  assertBranch(req, b.branch);
  const amount = r2(b.amount);
  if (amount <= 0) throw new AppError(400, 'Amount must be more than zero');
  if (!['expense', 'income', 'contra'].includes(b.type)) throw new AppError(400, 'Choose expense, income or contra');
  if (b.type !== 'contra' && !b.head) throw new AppError(400, 'Choose the head (e.g. Rent, Salary)');
  const branch = await Branch.findById(b.branch);
  const date = b.date ? new Date(b.date) : new Date();
  const voucherNo = await nextNumber('VC', branch.code, date);
  const refId = new mongoose.Types.ObjectId();
  const common = { branchId: branch._id, date, refType: 'Voucher', refId, ref: voucherNo, voucherNo, createdBy: req.user._id };
  const text = [b.paidTo, b.narration].filter(Boolean).join(' – ');
  if (b.type === 'contra') {
    if (!b.account || !b.toAccount || String(b.account) === String(b.toAccount)) throw new AppError(400, 'Pick two different accounts');
    const [from, to] = await Promise.all([resolveAccount({ accountId: b.account }), resolveAccount({ accountId: b.toAccount })]);
    await postCash({ ...common, accountId: from._id, direction: 'out', amount, category: 'contra', narration: `To ${to.name}${text ? ' – ' + text : ''}` });
    await postCash({ ...common, accountId: to._id, direction: 'in', amount, category: 'contra', narration: `From ${from.name}${text ? ' – ' + text : ''}` });
  } else {
    await postCash({
      ...common, accountId: b.account, mode: b.mode || 'cash', direction: b.type === 'expense' ? 'out' : 'in',
      amount, category: b.type, head: b.head, narration: `${b.head}${text ? ' – ' + text : ''}`,
    });
  }
  await audit(req, { action: 'create', entity: 'Voucher', entityId: refId, ref: voucherNo, branch: branch._id, changes: { type: b.type, head: b.head, amount } });
  ok(res, { voucherNo, refId }, `Voucher ${voucherNo} saved`, 201);
});

export const listVouchers = ah(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const { start, end } = range(req.query);
  const ids = visibleIds(req);
  const match = { refType: 'Voucher', category: { $in: ['expense', 'income', 'contra'] }, date: { $gte: start, $lte: end }, ...(ids && { branch: { $in: ids } }) };
  if (req.query.type) match.category = req.query.type;
  if (req.query.head) match.head = req.query.head;
  const rows = await CashEntry.aggregate([
    { $match: match },
    { $sort: { date: -1, _id: -1 } },
    { $group: { _id: '$refId', voucherNo: { $first: '$voucherNo' }, date: { $first: '$date' }, branch: { $first: '$branch' }, category: { $first: '$category' }, head: { $first: '$head' }, amount: { $max: '$amount' }, narration: { $first: '$narration' }, reversed: { $max: '$reversed' }, accounts: { $addToSet: '$account' } } },
    { $sort: { date: -1, voucherNo: -1 } },
    { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'n' }], sums: [{ $match: { reversed: false } }, { $group: { _id: '$category', amount: { $sum: '$amount' } } }] } },
  ]);
  const f = rows[0];
  const accs = Object.fromEntries((await MoneyAccount.find().select('name').lean()).map((a) => [String(a._id), a.name]));
  const brs = Object.fromEntries((await Branch.find().select('code').lean()).map((b) => [String(b._id), b.code]));
  ok(res, {
    items: f.items.map((v) => ({ ...v, branchCode: brs[String(v.branch)], accountNames: v.accounts.map((a) => accs[String(a)]) })),
    total: f.total[0]?.n || 0, page, limit,
    sums: Object.fromEntries(f.sums.map((s) => [s._id, s.amount])),
  });
});

export const cancelVoucher = ah(async (req, res) => {
  const first = await CashEntry.findOne({ refType: 'Voucher', refId: req.params.id, category: { $ne: 'reversal' } });
  if (!first) throw new AppError(404, 'Voucher not found');
  assertBranch(req, first.branch);
  const n = await reverseCash({ refType: 'Voucher', refId: first.refId, userId: req.user._id, narration: `Voucher ${first.voucherNo} cancelled${req.body?.reason ? ': ' + req.body.reason : ''}` });
  if (!n) throw new AppError(400, 'Voucher already cancelled');
  await audit(req, { action: 'cancel', entity: 'Voucher', entityId: first.refId, ref: first.voucherNo, branch: first.branch, changes: { reason: req.body?.reason } });
  ok(res, null, `Voucher ${first.voucherNo} cancelled`);
});

// ═════════════════════ CASH BOOK / BANK BOOK ═══════════════════════════════

export const cashBook = ah(async (req, res) => {
  const acc = await MoneyAccount.findById(req.query.account).populate('branch', 'name code').lean();
  if (!acc) throw new AppError(404, 'Choose a cash or bank account');
  if (acc.branch) assertBranch(req, acc.branch._id);
  const { start, end } = range({ from: req.query.from || new Date().toISOString().slice(0, 10), to: req.query.to });
  const [pre] = await CashEntry.aggregate([
    { $match: { account: acc._id, date: { $lt: start } } },
    { $group: { _id: null, in: { $sum: { $cond: [{ $eq: ['$direction', 'in'] }, '$amount', 0] } }, out: { $sum: { $cond: [{ $eq: ['$direction', 'out'] }, '$amount', 0] } } } },
  ]);
  const opening = r2((acc.openingBalance || 0) + (pre?.in || 0) - (pre?.out || 0));
  const rows = await CashEntry.find({ account: acc._id, date: { $gte: start, $lte: end } }).populate('branch', 'code').sort({ date: 1, _id: 1 }).lean();
  let bal = opening;
  let tin = 0;
  let tout = 0;
  const entries = rows.map((e) => {
    if (e.direction === 'in') { bal = r2(bal + e.amount); tin += e.amount; } else { bal = r2(bal - e.amount); tout += e.amount; }
    return { ...e, balance: bal };
  });
  const data = { account: acc, opening, entries, totalIn: r2(tin), totalOut: r2(tout), closing: bal, from: start, to: end };
  if (req.query.pdf) return sendPdf(res, await cashBookPdf(data), `${acc.type === 'cash' ? 'CashBook' : 'BankBook'}-${acc.name}`);
  ok(res, data);
});

// ═════════════════════ LORRY HIRE (gaadi bhaada) ═══════════════════════════

export const lorryHire = ah(async (req, res) => {
  const ids = visibleIds(req);
  const filter = { status: { $ne: 'cancelled' }, lorryHire: { $gt: 0 }, ...(ids && { fromBranch: { $in: ids } }) };
  if (req.query.status !== 'all') filter.$expr = { $gt: ['$lorryHire', { $ifNull: ['$hirePaid', 0] }] };
  const items = await Challan.find(filter).select('challanNo type vehicleNo transporter driverName dispatchedAt lorryHire advancePaid hirePaid fromBranch toBranch status')
    .populate('fromBranch toBranch', 'code name').sort({ dispatchedAt: 1 }).limit(500).lean();
  ok(res, { items: items.map((c) => ({ ...c, pending: r2(c.lorryHire - (c.hirePaid || 0)) })), totalPending: r2(items.reduce((s, c) => s + c.lorryHire - (c.hirePaid || 0), 0)) });
});

export const payLorryHire = ah(async (req, res) => {
  const ch = await Challan.findById(req.params.id);
  if (!ch || ch.status === 'cancelled') throw new AppError(404, 'Challan not found');
  const branch = req.body?.branch || ch.toBranch; // balance is usually paid where the truck unloads
  assertBranch(req, branch);
  const amount = r2(req.body?.amount);
  const pending = r2(ch.lorryHire - (ch.hirePaid || 0));
  if (amount <= 0) throw new AppError(400, 'Amount must be more than zero');
  if (amount > pending + 0.009) throw new AppError(400, `Only ₹${pending} lorry hire is pending`);
  await postCash({ accountId: req.body?.account, branchId: branch, mode: req.body?.mode || 'cash', direction: 'out', amount, category: 'lorry_hire', refType: 'Challan', refId: ch._id, ref: ch.challanNo, narration: `Lorry hire balance – ${ch.vehicleNo || ''} ${ch.challanNo}${req.body?.narration ? ' – ' + req.body.narration : ''}`, createdBy: req.user._id });
  ch.hirePaid = r2((ch.hirePaid || 0) + amount);
  ch.hireSettled = ch.hirePaid >= ch.lorryHire - 0.009;
  await ch.save();
  await audit(req, { action: 'update', entity: 'Challan', entityId: ch._id, ref: ch.challanNo, branch, changes: { hirePaid: amount } });
  ok(res, { pending: r2(ch.lorryHire - ch.hirePaid) }, `₹${amount} lorry hire paid`);
});

// ═════════════════════ PROFIT & LOSS (point 11) ════════════════════════════

const month = (field) => ({ $dateToString: { format: '%Y-%m', date: field, timezone: TZ } });

export const pnl = ah(async (req, res) => {
  const { start, end } = range(req.query);
  const ids = visibleIds(req);
  const inB = (f) => (ids ? { [f]: { $in: ids } } : {});

  const [freight, lorry, commission, discounts, claims, cash] = await Promise.all([
    LR.aggregate([
      { $match: { lrDate: { $gte: start, $lte: end }, status: { $ne: 'cancelled' }, ...inB('bookingBranch') } },
      { $group: { _id: { b: '$bookingBranch', m: month('$lrDate') }, v: { $sum: { $subtract: ['$freight.total', { $ifNull: ['$freight.gstAmount', 0] }] } }, lrs: { $sum: 1 } } },
    ]),
    Challan.aggregate([
      { $match: { dispatchedAt: { $gte: start, $lte: end }, status: { $ne: 'cancelled' }, ...inB('fromBranch') } },
      { $group: { _id: { b: '$fromBranch', m: month('$dispatchedAt') }, v: { $sum: '$lorryHire' } } },
    ]),
    LedgerEntry.aggregate([
      { $match: { account: 'broker', type: { $in: ['commission', 'commission_reversal'] }, date: { $gte: start, $lte: end }, ...inB('branch') } },
      { $group: { _id: { b: '$branch', m: month('$date') }, v: { $sum: { $subtract: ['$credit', '$debit'] } } } },
    ]),
    Bill.aggregate([
      { $match: { billDate: { $gte: start, $lte: end }, status: { $ne: 'cancelled' }, discount: { $gt: 0 }, ...inB('branch') } },
      { $group: { _id: { b: '$branch', m: month('$billDate') }, v: { $sum: '$discount' } } },
    ]),
    Claim.aggregate([
      { $match: { status: 'settled', settledAmount: { $gt: 0 }, updatedAt: { $gte: start, $lte: end }, ...inB('branch') } },
      { $group: { _id: { b: '$branch', m: month('$updatedAt') }, v: { $sum: '$settledAmount' } } },
    ]),
    CashEntry.aggregate([
      {
        $match: {
          date: { $gte: start, $lte: end }, ...inB('branch'),
          $or: [{ category: { $in: ['expense', 'income'] } }, { category: 'reversal', reversalCategory: { $in: ['expense', 'income'] } }],
        },
      },
      {
        $group: {
          _id: { b: '$branch', m: month('$date'), k: { $ifNull: ['$reversalCategory', '$category'] }, h: '$head' },
          // expense = out − reversal in ; income = in − reversal out
          v: { $sum: { $cond: [{ $eq: ['$category', 'reversal'] }, { $multiply: ['$amount', -1] }, '$amount'] } },
        },
      },
    ]),
  ]);

  const branches = await Branch.find(ids ? { _id: { $in: ids } } : { active: { $ne: false } }).select('name code type').sort({ type: -1, name: 1 }).lean();
  const blank = () => ({ freight: 0, otherIncome: 0, lorryHire: 0, brokerCommission: 0, discount: 0, claims: 0, expenses: 0, heads: {}, lrs: 0 });
  const byBranch = Object.fromEntries(branches.map((b) => [String(b._id), blank()]));
  const byMonth = {};
  const add = (b, m, key, v, head) => {
    const B = byBranch[String(b)] || (byBranch[String(b)] = blank());
    const M = byMonth[m] || (byMonth[m] = blank());
    for (const T of [B, M]) {
      T[key] = r2(T[key] + v);
      if (head) T.heads[head] = r2((T.heads[head] || 0) + v);
    }
  };
  for (const x of freight) { add(x._id.b, x._id.m, 'freight', x.v); byBranch[String(x._id.b)].lrs += x.lrs; }
  for (const x of lorry) add(x._id.b, x._id.m, 'lorryHire', x.v);
  for (const x of commission) add(x._id.b, x._id.m, 'brokerCommission', x.v);
  for (const x of discounts) add(x._id.b, x._id.m, 'discount', x.v);
  for (const x of claims) add(x._id.b, x._id.m, 'claims', x.v);
  for (const x of cash) {
    if (x._id.k === 'income') add(x._id.b, x._id.m, 'otherIncome', x.v);
    else add(x._id.b, x._id.m, 'expenses', x.v, x._id.h || 'Other expenses');
  }
  const finish = (t) => {
    t.income = r2(t.freight + t.otherIncome);
    t.totalExpense = r2(t.lorryHire + t.brokerCommission + t.discount + t.claims + t.expenses);
    t.profit = r2(t.income - t.totalExpense);
    t.margin = t.income ? Math.round((t.profit / t.income) * 1000) / 10 : 0;
    return t;
  };
  const rows = branches.map((b) => ({ branch: b, ...finish(byBranch[String(b._id)]) }));
  const total = finish(rows.reduce((t, r) => {
    for (const k of ['freight', 'otherIncome', 'lorryHire', 'brokerCommission', 'discount', 'claims', 'expenses', 'lrs']) t[k] = r2(t[k] + r[k]);
    for (const [h, v] of Object.entries(r.heads)) t.heads[h] = r2((t.heads[h] || 0) + v);
    return t;
  }, blank()));
  const months = Object.keys(byMonth).sort().map((m) => ({ month: m, ...finish(byMonth[m]) }));
  const data = { from: start, to: end, rows, total, months };
  if (req.query.pdf) return sendPdf(res, await pnlPdf(data), 'Profit-and-Loss');
  ok(res, data);
});

// ═════════════════════ PAYABLES (किस को कितना देना है) ══════════════════════

export const payables = ah(async (req, res) => {
  const ids = visibleIds(req);
  const [brokerBal, hire, partyBal] = await Promise.all([
    LedgerEntry.aggregate([
      { $match: { account: 'broker' } },
      { $group: { _id: '$broker', v: { $sum: { $subtract: ['$credit', '$debit'] } } } },
      { $match: { v: { $gt: 0.009 } } },
    ]),
    Challan.aggregate([
      { $match: { status: { $ne: 'cancelled' }, lorryHire: { $gt: 0 }, ...(ids && { fromBranch: { $in: ids } }), $expr: { $gt: ['$lorryHire', { $ifNull: ['$hirePaid', 0] }] } } },
      { $group: { _id: { $ifNull: ['$transporter', '$vehicleNo'] }, v: { $sum: { $subtract: ['$lorryHire', { $ifNull: ['$hirePaid', 0] }] } }, challans: { $sum: 1 }, vehicles: { $addToSet: '$vehicleNo' } } },
    ]),
    LedgerEntry.aggregate([
      { $match: { account: 'party' } },
      { $group: { _id: '$party', v: { $sum: { $subtract: ['$debit', '$credit'] } } } },
    ]),
  ]);
  const brokers = Object.fromEntries((await Broker.find({ _id: { $in: brokerBal.map((b) => b._id) } }).select('name mobile').lean()).map((b) => [String(b._id), b]));
  // parties with credit balance (advance taken from them)
  const parties = await Party.find({ $or: [{ _id: { $in: partyBal.map((p) => p._id) } }, { openingBalance: { $lt: 0 } }] }).select('name mobile openingBalance').lean();
  const pb = Object.fromEntries(partyBal.map((p) => [String(p._id), p.v]));
  const partyCredit = parties
    .map((p) => ({ _id: p._id, name: p.name, mobile: p.mobile, amount: r2(-((p.openingBalance || 0) + (pb[String(p._id)] || 0))) }))
    .filter((p) => p.amount > 0.009);
  const out = {
    brokers: brokerBal.map((b) => ({ _id: b._id, name: brokers[String(b._id)]?.name, mobile: brokers[String(b._id)]?.mobile, amount: r2(b.v) })),
    lorryHire: hire.map((h) => ({ name: h._id || 'Unknown', challans: h.challans, vehicles: h.vehicles.filter(Boolean), amount: r2(h.v) })),
    partyAdvances: partyCredit,
  };
  out.totals = {
    brokers: r2(out.brokers.reduce((s, x) => s + x.amount, 0)),
    lorryHire: r2(out.lorryHire.reduce((s, x) => s + x.amount, 0)),
    partyAdvances: r2(out.partyAdvances.reduce((s, x) => s + x.amount, 0)),
  };
  out.totals.all = r2(out.totals.brokers + out.totals.lorryHire + out.totals.partyAdvances);
  ok(res, out);
});
