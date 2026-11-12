import mongoose from 'mongoose';
import { LR } from '../models/lrModel.js';
import { Party, Broker } from '../models/masterModels.js';
import { Bill, LedgerEntry, Receipt } from '../models/accountsModels.js';

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const oid = (x) => new mongoose.Types.ObjectId(String(x));

/**
 * Which LRs go on a party bill:
 *  - TBB LRs billed to this party (any status except cancelled)
 *  - TO PAY LRs delivered without full collection (allowCredit at delivery) – billed to consignee
 */
export const billableFilter = (partyId) => ({
  billed: { $ne: true },
  status: { $ne: 'cancelled' },
  $or: [
    { paymentType: 'tbb', billingParty: oid(partyId) },
    {
      paymentType: 'to_pay',
      status: 'delivered',
      'consignee.party': oid(partyId),
      $expr: { $lt: [{ $ifNull: ['$delivery.collectedAmount', 0] }, '$freight.total'] },
    },
  ],
});

export const billableAmount = (lr) =>
  lr.paymentType === 'to_pay' ? r2(lr.freight.total - (lr.delivery?.collectedAmount || 0)) : r2(lr.freight.total);

/** Ledger balance for one party: + means party owes us */
export const partyBalance = async (partyId) => {
  const [p, agg] = await Promise.all([
    Party.findById(partyId).select('openingBalance').lean(),
    LedgerEntry.aggregate([
      { $match: { account: 'party', party: oid(partyId) } },
      { $group: { _id: null, dr: { $sum: '$debit' }, cr: { $sum: '$credit' } } },
    ]),
  ]);
  return r2((p?.openingBalance || 0) + (agg[0]?.dr || 0) - (agg[0]?.cr || 0));
};

export const unbilledAmount = async (partyId) => {
  const lrs = await LR.find(billableFilter(partyId)).select('paymentType freight.total delivery.collectedAmount').lean();
  return r2(lrs.reduce((s, l) => s + billableAmount(l), 0));
};

/** Credit control: outstanding + unbilled + this LR vs party credit limit */
export const creditCheck = async (partyId, adding = 0) => {
  const p = await Party.findById(partyId).select('name creditLimit').lean();
  if (!p?.creditLimit) return null;
  const [bal, unb] = await Promise.all([partyBalance(partyId), unbilledAmount(partyId)]);
  const exposure = r2(bal + unb + adding);
  return exposure > p.creditLimit
    ? `Credit limit crossed for ${p.name}: limit ₹${p.creditLimit}, outstanding ₹${Math.round(bal)} + unbilled ₹${Math.round(unb)} + this LR ₹${Math.round(adding)}`
    : null;
};

// ── Broker commission (point 8 + 14) ──────────────────────────────────────
export const commissionFor = (broker, lr) => {
  if (!broker) return 0;
  if (broker.commissionType === 'fixed_per_lr') return r2(broker.commissionValue);
  return r2(((lr.freight?.basicFreight || 0) * (broker.commissionValue || 0)) / 100);
};

/** Post (or re-post after an edit) the commission for an LR */
export const syncCommission = async (lr, userId) => {
  const existing = await LedgerEntry.find({ account: 'broker', refId: lr._id, type: { $in: ['commission', 'commission_reversal'] } }).lean();
  const net = existing.reduce((s, e) => s + e.credit - e.debit, 0);
  const brokerId = lr.broker?._id || lr.broker;
  const prevBroker = existing.find((e) => e.type === 'commission')?.broker;
  const want = lr.status === 'cancelled' || !brokerId ? 0 : commissionFor(await Broker.findById(brokerId).lean(), lr);
  // reverse old broker if changed or amount differs
  if (net && (String(prevBroker) !== String(brokerId) || r2(net) !== want)) {
    await LedgerEntry.create({
      account: 'broker', broker: prevBroker, type: 'commission_reversal', ref: lr.lrNo, refId: lr._id,
      branch: lr.bookingBranch?._id || lr.bookingBranch, debit: r2(net), narration: lr.status === 'cancelled' ? 'LR cancelled' : 'LR changed', createdBy: userId,
    });
  }
  if (want && (String(prevBroker) !== String(brokerId) || r2(net) !== want)) {
    await LedgerEntry.create({
      account: 'broker', broker: brokerId, type: 'commission', ref: lr.lrNo, refId: lr._id, date: lr.lrDate,
      branch: lr.bookingBranch?._id || lr.bookingBranch, credit: want, narration: `Commission on LR ${lr.lrNo}`, createdBy: userId,
    });
  }
  await LR.updateOne({ _id: lr._id }, { brokerCommission: want });
  return want;
};

// ── Bill status after a payment change ────────────────────────────────────
export const refreshBill = async (billId) => {
  const b = await Bill.findById(billId);
  if (!b || b.status === 'cancelled') return b;
  b.balance = r2(b.total - b.received);
  b.status = b.received <= 0.009 ? 'unpaid' : b.balance <= 0.009 ? 'paid' : 'partial';
  if (b.balance < 0) b.balance = 0;
  await b.save();
  return b;
};

// ── Outstanding with ageing (point 7: कितने दिन से भुगतान बाकी है) ───────────
const BUCKETS = [
  { key: 'b0_30', max: 30 },
  { key: 'b31_60', max: 60 },
  { key: 'b61_90', max: 90 },
  { key: 'b90p', max: Infinity },
];

export const outstandingReport = async ({ branchIds, partyId, asOn = new Date() } = {}) => {
  const billMatch = { status: { $in: ['unpaid', 'partial'] } };
  if (branchIds) billMatch.branch = { $in: branchIds.map(oid) };
  if (partyId) billMatch.party = oid(partyId);
  const bills = await Bill.find(billMatch).select('party partyName billNo billDate dueDate balance').lean();

  const rows = new Map();
  const row = (id, name) => {
    const k = String(id);
    if (!rows.has(k)) rows.set(k, { party: k, name, opening: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0, billed: 0, onAccount: 0, unbilled: 0, oldestDays: 0, overdue: 0 });
    return rows.get(k);
  };
  for (const b of bills) {
    const r = row(b.party, b.partyName);
    const days = Math.floor((asOn - new Date(b.billDate)) / 86400000);
    r[BUCKETS.find((x) => days <= x.max).key] += b.balance;
    r.billed += b.balance;
    r.oldestDays = Math.max(r.oldestDays, days);
    if (b.dueDate && new Date(b.dueDate) < asOn) r.overdue += b.balance;
  }

  // parties with opening balance or on-account advance (only for head-office view)
  if (!branchIds) {
    const pf = { $or: [{ openingBalance: { $ne: 0 } }, { _id: { $in: [...rows.keys()].map(oid) } }] };
    if (partyId) pf._id = oid(partyId);
    const parties = await Party.find(pf).select('name openingBalance').lean();
    const recAgg = await Receipt.aggregate([
      { $match: { status: 'active', onAccount: { $gt: 0 }, ...(partyId ? { party: oid(partyId) } : {}) } },
      { $group: { _id: '$party', onAccount: { $sum: '$onAccount' } } },
    ]);
    const onAcc = Object.fromEntries(recAgg.map((x) => [String(x._id), x.onAccount]));
    for (const p of parties) {
      const r = row(p._id, p.name);
      r.opening = p.openingBalance || 0;
    }
    for (const [k, v] of Object.entries(onAcc)) if (rows.has(k) || v) row(k, parties.find((p) => String(p._id) === k)?.name).onAccount = v;
  }

  // unbilled per party (TBB + credit to-pay)
  const list = [...rows.values()];
  for (const r of list) {
    r.unbilled = await unbilledAmount(r.party);
    r.net = r2(r.opening + r.billed - r.onAccount);
    for (const k of ['b0_30', 'b31_60', 'b61_90', 'b90p', 'billed', 'overdue']) r[k] = r2(r[k]);
  }
  if (list.some((r) => !r.name)) {
    const names = Object.fromEntries((await Party.find({ _id: { $in: list.filter((r) => !r.name).map((r) => oid(r.party)) } }).select('name').lean()).map((p) => [String(p._id), p.name]));
    for (const r of list) r.name = r.name || names[r.party];
  }
  const out = list.filter((r) => Math.abs(r.net) > 0.009 || r.unbilled > 0).sort((a, b) => b.net - a.net);
  const totals = out.reduce((t, r) => {
    for (const k of ['opening', 'b0_30', 'b31_60', 'b61_90', 'b90p', 'billed', 'onAccount', 'unbilled', 'net', 'overdue']) t[k] = r2((t[k] || 0) + r[k]);
    return t;
  }, {});
  return { rows: out, totals };
};
