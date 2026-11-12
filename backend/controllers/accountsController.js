import mongoose from 'mongoose';
import { LR } from '../models/lrModel.js';
import { Branch, Party, Broker } from '../models/masterModels.js';
import { Bill, Receipt, LedgerEntry } from '../models/accountsModels.js';
import { ah, ok, AppError, sendPdf, paginate, escapeRegex } from '../utils/http.js';
import { assertBranch } from '../middleware/authRoles.js';
import { nextNumber } from '../services/numbering.js';
import { audit } from '../services/auditService.js';
import { notify } from '../services/notificationService.js';
import { billPdf, receiptPdf, ledgerPdf } from '../services/pdfService.js';
import { postCash, reverseCash } from '../services/financeService.js';
import {
  r2, billableFilter, billableAmount, partyBalance, unbilledAmount, refreshBill, outstandingReport,
} from '../services/accountService.js';

const oid = (x) => new mongoose.Types.ObjectId(String(x));
const visibleBranches = (req) => (req.allBranches ? null : req.branchIds);
const lrInScope = (req) =>
  req.allBranches ? {} : { $or: [{ bookingBranch: { $in: req.branchIds.map(oid) } }, { deliveryBranch: { $in: req.branchIds.map(oid) } }] };
// aggregate() does not cast like find(), so turn id strings into ObjectIds for $match
const castIds = (f) => {
  const out = { ...f };
  for (const k of ['branch', 'party']) {
    if (typeof out[k] === 'string') out[k] = oid(out[k]);
    else if (out[k]?.$in) out[k] = { $in: out[k].$in.map(oid) };
  }
  return out;
};
const dateRange = (q, field) => {
  if (!q.from && !q.to) return {};
  const r = {};
  if (q.from) r.$gte = new Date(new Date(q.from).setHours(0, 0, 0, 0));
  if (q.to) r.$lte = new Date(new Date(q.to).setHours(23, 59, 59, 999));
  return { [field]: r };
};

// ═════════════════════════════ BILLING ═════════════════════════════════════

/** Parties that have LRs waiting to be billed (who to bill today) */
export const partiesToBill = ah(async (req, res) => {
  const scope = lrInScope(req);
  const base = { billed: { $ne: true }, status: { $ne: 'cancelled' }, ...scope };
  const [tbb, credit] = await Promise.all([
    LR.aggregate([
      { $match: { ...base, paymentType: 'tbb', billingParty: { $ne: null } } },
      { $group: { _id: '$billingParty', lrs: { $sum: 1 }, amount: { $sum: '$freight.total' }, oldest: { $min: '$lrDate' } } },
    ]),
    LR.aggregate([
      { $match: { ...base, paymentType: 'to_pay', status: 'delivered', $expr: { $lt: [{ $ifNull: ['$delivery.collectedAmount', 0] }, '$freight.total'] } } },
      { $group: { _id: '$consignee.party', lrs: { $sum: 1 }, amount: { $sum: { $subtract: ['$freight.total', { $ifNull: ['$delivery.collectedAmount', 0] }] } }, oldest: { $min: '$lrDate' } } },
    ]),
  ]);
  const m = new Map();
  for (const x of [...tbb, ...credit]) {
    const k = String(x._id);
    const cur = m.get(k) || { party: k, lrs: 0, amount: 0, oldest: x.oldest };
    cur.lrs += x.lrs;
    cur.amount = r2(cur.amount + x.amount);
    if (x.oldest < cur.oldest) cur.oldest = x.oldest;
    m.set(k, cur);
  }
  const parties = await Party.find({ _id: { $in: [...m.keys()].map(oid) } }).select('name mobile city creditDays').lean();
  const items = parties
    .map((p) => ({ ...m.get(String(p._id)), name: p.name, mobile: p.mobile, city: p.city }))
    .sort((a, b) => new Date(a.oldest) - new Date(b.oldest));
  ok(res, { items, total: items.length });
});

export const unbilledLRs = ah(async (req, res) => {
  if (!req.query.party) throw new AppError(400, 'party is required');
  const filter = { ...billableFilter(req.query.party), ...dateRange(req.query, 'lrDate') };
  const scope = lrInScope(req);
  const lrs = await LR.find(scope.$or ? { $and: [filter, scope] } : filter)
    .select('lrNo lrDate paymentType status totalNag totalWeight freight.total delivery.collectedAmount consignor.name consignee.name')
    .populate('bookingBranch deliveryBranch', 'code')
    .sort({ lrDate: 1 })
    .lean();
  const items = lrs.map((l) => ({ ...l, amount: billableAmount(l) }));
  ok(res, { items, total: items.length, amount: r2(items.reduce((s, i) => s + i.amount, 0)) });
});

export const createBill = ah(async (req, res) => {
  const b = req.body || {};
  assertBranch(req, b.branch);
  if (!b.lrIds?.length) throw new AppError(400, 'Select LRs to bill');
  const [party, branch] = await Promise.all([Party.findById(b.party), Branch.findById(b.branch)]);
  if (!party || !branch) throw new AppError(400, 'Party and branch are required');

  const filter = { _id: { $in: b.lrIds.map(oid) }, ...billableFilter(party._id) };
  const scope = lrInScope(req);
  const lrs = await LR.find(scope.$or ? { $and: [filter, scope] } : filter).populate('bookingBranch deliveryBranch', 'code').lean();
  if (lrs.length !== b.lrIds.length) throw new AppError(409, 'Some LRs are already billed, cancelled or not billable to this party. Refresh and try again.');

  const billDate = b.billDate ? new Date(b.billDate) : new Date();
  const lines = lrs.map((l) => ({
    lr: l._id, lrNo: l.lrNo, lrDate: l.lrDate, route: `${l.bookingBranch?.code} → ${l.deliveryBranch?.code}`,
    consignor: l.consignor.name, consignee: l.consignee.name, nag: l.totalNag, weight: l.totalWeight,
    paymentType: l.paymentType, amount: billableAmount(l),
  }));
  const subTotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const total = r2(subTotal - (Number(b.discount) || 0) + (Number(b.otherCharges) || 0));
  if (total <= 0) throw new AppError(400, 'Bill total must be more than zero');
  const billNo = await nextNumber('BL', branch.code, billDate);
  const bill = await Bill.create({
    billNo, billDate, dueDate: new Date(billDate.getTime() + (party.creditDays ?? 30) * 86400000),
    branch: branch._id, party: party._id, partyName: party.name, lines, subTotal,
    discount: Number(b.discount) || 0, otherCharges: Number(b.otherCharges) || 0, total, received: 0, balance: total,
    remarks: b.remarks, createdBy: req.user._id,
  });
  // lock LRs – conditional so two clerks cannot bill the same LR
  const r = await LR.updateMany({ _id: { $in: lrs.map((l) => l._id) }, billed: { $ne: true } }, { billed: true, bill: bill._id });
  if (r.modifiedCount !== lrs.length) {
    await LR.updateMany({ bill: bill._id }, { billed: false, $unset: { bill: 1 } });
    await Bill.deleteOne({ _id: bill._id });
    throw new AppError(409, 'Another bill took some of these LRs just now. Refresh and try again.');
  }
  await LedgerEntry.create({
    account: 'party', party: party._id, date: billDate, type: 'bill', ref: billNo, refId: bill._id,
    branch: branch._id, debit: total, narration: `Bill ${billNo} – ${lines.length} LR`, createdBy: req.user._id,
  });
  await audit(req, { action: 'create', entity: 'Bill', entityId: bill._id, ref: billNo, branch: branch._id, changes: { party: party.name, lrs: lines.length, total } });
  ok(res, bill, `Bill ${billNo} created`, 201);
});

export const listBills = ah(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const q = req.query;
  const filter = { ...dateRange(q, 'billDate') };
  if (q.branch) { assertBranch(req, q.branch); filter.branch = q.branch; } else if (!req.allBranches) filter.branch = { $in: req.branchIds };
  if (q.party) filter.party = q.party;
  if (q.status) filter.status = { $in: String(q.status).split(',') };
  if (q.overdue === '1') { filter.dueDate = { $lt: new Date() }; filter.status = { $in: ['unpaid', 'partial'] }; }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ billNo: rx }, { partyName: rx }, { 'lines.lrNo': rx }];
  }
  const [items, total, sums] = await Promise.all([
    Bill.find(filter).select('-lines').populate('branch', 'code').sort({ billDate: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Bill.countDocuments(filter),
    Bill.aggregate([{ $match: castIds({ ...filter, status: { $ne: 'cancelled' }, ...(filter.status && { status: filter.status }) }) }, { $group: { _id: null, total: { $sum: '$total' }, received: { $sum: '$received' }, balance: { $sum: '$balance' } } }]),
  ]);
  ok(res, { items, total, page, limit, sums: sums[0] || { total: 0, received: 0, balance: 0 } });
});

const loadBill = async (req, id) => {
  const b = await Bill.findById(id).populate('branch', 'name code address phone gstin').populate('party', 'name mobile address city state gstin');
  if (!b) throw new AppError(404, 'Bill not found');
  assertBranch(req, b.branch._id);
  return b;
};

export const getBill = ah(async (req, res) => {
  const b = await loadBill(req, req.params.id);
  const receipts = await Receipt.find({ 'allocations.bill': b._id, status: 'active' }).select('receiptNo date mode allocations').lean();
  ok(res, { ...b.toObject(), payments: receipts.map((r) => ({ _id: r._id, receiptNo: r.receiptNo, date: r.date, mode: r.mode, amount: r.allocations.find((a) => String(a.bill) === String(b._id))?.amount })) });
});

export const billPdfCtl = ah(async (req, res) => {
  const b = await loadBill(req, req.params.id);
  sendPdf(res, await billPdf(b.toObject()), b.billNo);
});

export const cancelBill = ah(async (req, res) => {
  const reason = req.body?.reason;
  if (!reason) throw new AppError(400, 'Give a reason for cancelling');
  const b = await loadBill(req, req.params.id);
  if (b.status === 'cancelled') throw new AppError(400, 'Already cancelled');
  if (b.received > 0) throw new AppError(400, 'Payment is already adjusted against this bill. Cancel those receipts first.');
  b.status = 'cancelled';
  b.cancelReason = reason;
  b.balance = 0;
  await b.save();
  await LR.updateMany({ bill: b._id }, { billed: false, $unset: { bill: 1 } });
  await LedgerEntry.create({
    account: 'party', party: b.party._id, type: 'bill_cancel', ref: b.billNo, refId: b._id, branch: b.branch._id,
    credit: b.total, narration: `Bill ${b.billNo} cancelled: ${reason}`, createdBy: req.user._id,
  });
  await audit(req, { action: 'cancel', entity: 'Bill', entityId: b._id, ref: b.billNo, branch: b.branch._id, changes: { reason } });
  ok(res, null, `Bill ${b.billNo} cancelled – its LRs can be billed again`);
});

// ═════════════════════════════ RECEIPTS ════════════════════════════════════

export const openBills = ah(async (req, res) => {
  if (!req.query.party) throw new AppError(400, 'party is required');
  const items = await Bill.find({ party: req.query.party, status: { $in: ['unpaid', 'partial'] } })
    .select('billNo billDate dueDate total received balance branch')
    .populate('branch', 'code')
    .sort({ billDate: 1 })
    .lean();
  const [balance, unbilled] = await Promise.all([partyBalance(req.query.party), unbilledAmount(req.query.party)]);
  ok(res, { items, balance, unbilled });
});

/**
 * Money received (point 8).
 * Body: { party, branch, amount, tds?, mode, reference?, date?, narration?, allocations?: [{bill, amount}] }
 * No allocations given → oldest bills are settled first (FIFO). Anything left is kept "on account".
 */
export const createReceipt = ah(async (req, res) => {
  const b = req.body || {};
  assertBranch(req, b.branch);
  const amount = r2(b.amount);
  const tds = r2(b.tds);
  if (amount <= 0) throw new AppError(400, 'Amount must be more than zero');
  const [party, branch] = await Promise.all([Party.findById(b.party), Branch.findById(b.branch)]);
  if (!party || !branch) throw new AppError(400, 'Party and branch are required');
  if (['bank', 'upi', 'cheque'].includes(b.mode) && !b.reference) throw new AppError(400, 'Enter UTR / cheque number for bank payments');

  const open = await Bill.find({ party: party._id, status: { $in: ['unpaid', 'partial'] } }).sort({ billDate: 1, _id: 1 });
  let pool = r2(amount + tds); // TDS also settles the bill
  const allocations = [];
  if (Array.isArray(b.allocations) && b.allocations.length) {
    for (const a of b.allocations) {
      const bill = open.find((x) => String(x._id) === String(a.bill));
      const amt = r2(a.amount);
      if (!amt) continue;
      if (!bill) throw new AppError(400, 'A selected bill is not open for this party');
      if (amt > bill.balance + 0.009) throw new AppError(400, `${bill.billNo}: only ₹${bill.balance} is pending`);
      if (amt > pool + 0.009) throw new AppError(400, 'Adjusted amount is more than the money received');
      allocations.push({ bill: bill._id, billNo: bill.billNo, amount: amt });
      pool = r2(pool - amt);
    }
  } else if (b.autoAllocate !== false) {
    for (const bill of open) {
      if (pool <= 0) break;
      const amt = r2(Math.min(pool, bill.balance));
      allocations.push({ bill: bill._id, billNo: bill.billNo, amount: amt });
      pool = r2(pool - amt);
    }
  }
  const date = b.date ? new Date(b.date) : new Date();
  const receiptNo = await nextNumber('RC', branch.code, date);
  const receipt = await Receipt.create({
    receiptNo, date, branch: branch._id, party: party._id, partyName: party.name, amount, tds,
    mode: b.mode || 'cash', bankName: b.bankName, reference: b.reference, allocations, onAccount: pool,
    narration: b.narration, createdBy: req.user._id,
  });
  for (const a of allocations) {
    await Bill.updateOne({ _id: a.bill }, { $inc: { received: a.amount } });
    await refreshBill(a.bill);
  }
  const cash = await postCash({ accountId: b.account, branchId: branch._id, mode: receipt.mode, direction: 'in', amount, category: 'party_receipt', date, refType: 'Receipt', refId: receipt._id, ref: receiptNo, party: party._id, narration: `${party.name} – ${receiptNo}${b.reference ? ' ' + b.reference : ''}`, createdBy: req.user._id });
  if (cash) { receipt.account = cash.account; await receipt.save(); }
  await LedgerEntry.create({
    account: 'party', party: party._id, date, type: 'receipt', ref: receiptNo, refId: receipt._id, branch: branch._id,
    credit: r2(amount + tds), mode: receipt.mode,
    narration: `${receipt.mode.toUpperCase()}${b.reference ? ' ' + b.reference : ''}${tds ? ` (incl. TDS ₹${tds})` : ''}${allocations.length ? ' – ' + allocations.map((a) => a.billNo).join(', ') : ''}`,
    createdBy: req.user._id,
  });
  await audit(req, { action: 'create', entity: 'Receipt', entityId: receipt._id, ref: receiptNo, branch: branch._id, changes: { party: party.name, amount, tds, mode: receipt.mode, bills: allocations.map((a) => a.billNo) } });
  ok(res, receipt, `Receipt ${receiptNo} saved${pool ? ` – ₹${pool} kept on account` : ''}`, 201);
});

export const listReceipts = ah(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const q = req.query;
  const filter = { ...dateRange(q, 'date') };
  if (q.branch) { assertBranch(req, q.branch); filter.branch = q.branch; } else if (!req.allBranches) filter.branch = { $in: req.branchIds };
  if (q.party) filter.party = q.party;
  if (q.mode) filter.mode = q.mode;
  if (q.status) filter.status = q.status;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ receiptNo: rx }, { partyName: rx }, { reference: rx }];
  }
  const [items, total, sums] = await Promise.all([
    Receipt.find(filter).populate('branch', 'code').sort({ date: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Receipt.countDocuments(filter),
    Receipt.aggregate([{ $match: castIds({ ...filter, status: 'active' }) }, { $group: { _id: '$mode', amount: { $sum: '$amount' } } }]),
  ]);
  ok(res, { items, total, page, limit, byMode: Object.fromEntries(sums.map((s) => [s._id, s.amount])) });
});

const loadReceipt = async (req, id) => {
  const r = await Receipt.findById(id).populate('branch', 'name code address phone').populate('party', 'name mobile address city gstin');
  if (!r) throw new AppError(404, 'Receipt not found');
  assertBranch(req, r.branch._id);
  return r;
};

export const getReceipt = ah(async (req, res) => ok(res, (await loadReceipt(req, req.params.id)).toObject()));

export const receiptPdfCtl = ah(async (req, res) => {
  const r = await loadReceipt(req, req.params.id);
  sendPdf(res, await receiptPdf(r.toObject()), r.receiptNo);
});

export const cancelReceipt = ah(async (req, res) => {
  const reason = req.body?.reason;
  if (!reason) throw new AppError(400, 'Give a reason for cancelling');
  const r = await loadReceipt(req, req.params.id);
  if (r.status === 'cancelled') throw new AppError(400, 'Already cancelled');
  r.status = 'cancelled';
  r.cancelReason = reason;
  await r.save();
  for (const a of r.allocations) {
    await Bill.updateOne({ _id: a.bill }, { $inc: { received: -a.amount } });
    await refreshBill(a.bill);
  }
  await reverseCash({ refType: 'Receipt', refId: r._id, userId: req.user._id, narration: `Receipt ${r.receiptNo} cancelled: ${reason}` });
  await LedgerEntry.create({
    account: 'party', party: r.party._id, type: 'receipt_cancel', ref: r.receiptNo, refId: r._id, branch: r.branch._id,
    debit: r2(r.amount + (r.tds || 0)), narration: `Receipt ${r.receiptNo} cancelled: ${reason}`, createdBy: req.user._id,
  });
  await audit(req, { action: 'cancel', entity: 'Receipt', entityId: r._id, ref: r.receiptNo, branch: r.branch._id, changes: { reason, amount: r.amount } });
  ok(res, null, `Receipt ${r.receiptNo} cancelled – bills reopened`);
});

/** Adjust a party's on-account money against open bills later */
export const adjustOnAccount = ah(async (req, res) => {
  const r = await loadReceipt(req, req.params.id);
  if (r.status !== 'active' || r.onAccount <= 0) throw new AppError(400, 'Nothing on account in this receipt');
  const open = await Bill.find({ party: r.party._id, status: { $in: ['unpaid', 'partial'] } }).sort({ billDate: 1 });
  let pool = r.onAccount;
  const added = [];
  for (const bill of open) {
    if (pool <= 0) break;
    const amt = r2(Math.min(pool, bill.balance));
    await Bill.updateOne({ _id: bill._id }, { $inc: { received: amt } });
    await refreshBill(bill._id);
    added.push({ bill: bill._id, billNo: bill.billNo, amount: amt });
    pool = r2(pool - amt);
  }
  if (!added.length) throw new AppError(400, 'No open bill for this party');
  r.allocations.push(...added);
  r.onAccount = pool;
  await r.save();
  await audit(req, { action: 'update', entity: 'Receipt', entityId: r._id, ref: r.receiptNo, changes: { adjusted: added.map((a) => `${a.billNo}:${a.amount}`) } });
  ok(res, r, `Adjusted against ${added.map((a) => a.billNo).join(', ')}`);
});

// ═════════════════════════════ LEDGERS ═════════════════════════════════════

const buildLedger = async ({ account, id, from, to }) => {
  const key = account === 'party' ? 'party' : 'broker';
  const start = from ? new Date(new Date(from).setHours(0, 0, 0, 0)) : null;
  const end = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : new Date();
  let opening = 0;
  if (account === 'party') opening = (await Party.findById(id).select('openingBalance').lean())?.openingBalance || 0;
  if (start) {
    const [pre] = await LedgerEntry.aggregate([
      { $match: { account, [key]: oid(id), date: { $lt: start } } },
      { $group: { _id: null, dr: { $sum: '$debit' }, cr: { $sum: '$credit' } } },
    ]);
    opening += account === 'party' ? (pre?.dr || 0) - (pre?.cr || 0) : (pre?.cr || 0) - (pre?.dr || 0);
  }
  const rows = await LedgerEntry.find({ account, [key]: oid(id), date: { ...(start && { $gte: start }), $lte: end } })
    .populate('branch', 'code').sort({ date: 1, _id: 1 }).lean();
  let bal = r2(opening);
  let dr = 0;
  let cr = 0;
  const entries = rows.map((e) => {
    dr += e.debit;
    cr += e.credit;
    bal = r2(bal + (account === 'party' ? e.debit - e.credit : e.credit - e.debit));
    return { ...e, balance: bal };
  });
  return { opening: r2(opening), entries, totalDebit: r2(dr), totalCredit: r2(cr), closing: bal, from: start, to: end };
};

export const partyLedger = ah(async (req, res) => {
  const party = await Party.findById(req.params.id).select('name mobile address city gstin creditLimit creditDays lastReminderAt').lean();
  if (!party) throw new AppError(404, 'Party not found');
  const led = await buildLedger({ account: 'party', id: party._id, from: req.query.from, to: req.query.to });
  const unbilled = await unbilledAmount(party._id);
  if (req.query.pdf) return sendPdf(res, await ledgerPdf({ title: 'PARTY LEDGER', name: party.name, sub: [party.address, party.city, party.mobile].filter(Boolean).join(' · '), ...led, kind: 'party' }), `Ledger-${party.name}`);
  ok(res, { party, ...led, unbilled });
});

export const brokerLedger = ah(async (req, res) => {
  const broker = await Broker.findById(req.params.id).lean();
  if (!broker) throw new AppError(404, 'Broker not found');
  const led = await buildLedger({ account: 'broker', id: broker._id, from: req.query.from, to: req.query.to });
  if (req.query.pdf) return sendPdf(res, await ledgerPdf({ title: 'BROKER LEDGER', name: broker.name, sub: broker.mobile, ...led, kind: 'broker' }), `Broker-${broker.name}`);
  ok(res, { broker, ...led });
});

export const payBroker = ah(async (req, res) => {
  const b = req.body || {};
  assertBranch(req, b.branch);
  const broker = await Broker.findById(req.params.id);
  if (!broker) throw new AppError(404, 'Broker not found');
  const amount = r2(b.amount);
  if (amount <= 0) throw new AppError(400, 'Amount must be more than zero');
  const e = await LedgerEntry.create({
    account: 'broker', broker: broker._id, date: b.date ? new Date(b.date) : new Date(), type: 'broker_payment',
    ref: b.reference, branch: b.branch, debit: amount, mode: b.mode || 'cash',
    narration: `Paid ${b.mode || 'cash'}${b.reference ? ' ' + b.reference : ''}${b.narration ? ' – ' + b.narration : ''}`, createdBy: req.user._id,
  });
  await postCash({ accountId: b.account, branchId: b.branch, mode: e.mode, direction: 'out', amount, category: 'broker_payment', date: e.date, refType: 'BrokerPayment', refId: e._id, ref: broker.name, broker: broker._id, narration: `Broker ${broker.name}${b.reference ? ' – ' + b.reference : ''}`, createdBy: req.user._id });
  await audit(req, { action: 'create', entity: 'BrokerPayment', entityId: e._id, ref: broker.name, branch: b.branch, changes: { amount, mode: e.mode } });
  ok(res, e, `₹${amount} paid to ${broker.name}`, 201);
});

/** Broker summary: commission earned, paid and pending */
export const brokerSummary = ah(async (req, res) => {
  const range = dateRange(req.query, 'date');
  const agg = await LedgerEntry.aggregate([
    { $match: { account: 'broker', ...range } },
    {
      $group: {
        _id: '$broker',
        commission: { $sum: { $cond: [{ $eq: ['$type', 'commission'] }, '$credit', 0] } },
        reversed: { $sum: { $cond: [{ $eq: ['$type', 'commission_reversal'] }, '$debit', 0] } },
        paid: { $sum: { $cond: [{ $eq: ['$type', 'broker_payment'] }, '$debit', 0] } },
        lrs: { $sum: { $cond: [{ $eq: ['$type', 'commission'] }, 1, 0] } },
      },
    },
  ]);
  const all = await LedgerEntry.aggregate([
    { $match: { account: 'broker' } },
    { $group: { _id: '$broker', bal: { $sum: { $subtract: ['$credit', '$debit'] } } } },
  ]);
  const balMap = Object.fromEntries(all.map((x) => [String(x._id), x.bal]));
  const brokers = await Broker.find({ active: { $ne: false } }).select('name mobile commissionType commissionValue').lean();
  const m = Object.fromEntries(agg.map((x) => [String(x._id), x]));
  const items = brokers.map((b) => {
    const x = m[String(b._id)] || {};
    return { ...b, lrs: x.lrs || 0, commission: r2((x.commission || 0) - (x.reversed || 0)), paid: r2(x.paid || 0), pending: r2(balMap[String(b._id)] || 0) };
  });
  ok(res, { items });
});

// ═════════════════════════════ OUTSTANDING & REMINDERS ═════════════════════

export const outstanding = ah(async (req, res) => {
  let branchIds = visibleBranches(req);
  if (req.query.branch) { assertBranch(req, req.query.branch); branchIds = [req.query.branch]; }
  ok(res, await outstandingReport({ branchIds, partyId: req.query.party }));
});

export const sendReminder = ah(async (req, res) => {
  const party = await Party.findById(req.params.id);
  if (!party) throw new AppError(404, 'Party not found');
  const balance = await partyBalance(party._id);
  if (balance <= 0) throw new AppError(400, `${party.name} has nothing pending`);
  const oldest = await Bill.findOne({ party: party._id, status: { $in: ['unpaid', 'partial'] } }).sort({ billDate: 1 }).select('billDate').lean();
  const days = oldest ? Math.floor((Date.now() - new Date(oldest.billDate)) / 86400000) : 0;
  const rec = await notify({ event: 'payment_reminder', mobile: party.mobile, party: party._id, params: { amount: Math.round(balance), days } });
  party.lastReminderAt = new Date();
  await party.save();
  await audit(req, { action: 'status', entity: 'Party', entityId: party._id, ref: party.name, changes: { reminder: rec?.status, amount: balance } });
  ok(res, { status: rec?.status, amount: balance, days }, rec?.status === 'skipped' ? 'No valid mobile number on this party' : 'Reminder sent');
});
