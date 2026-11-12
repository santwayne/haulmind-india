import mongoose from 'mongoose';
import { LR } from '../models/lrModel.js';
import { Challan } from '../models/challanModel.js';
import { Branch } from '../models/masterModels.js';
import { AuditLog, Notification, BranchAlert, Claim } from '../models/systemModels.js';
import { Bill, Receipt } from '../models/accountsModels.js';
import { ah, ok, dayRange, paginate } from '../utils/http.js';
import { assertBranch } from '../middleware/authRoles.js';

const oid = (x) => new mongoose.Types.ObjectId(String(x));

// Branches the user may see (optionally narrowed with ?branch=)
const visibleBranchIds = (req) => {
  if (req.query.branch) {
    assertBranch(req, req.query.branch);
    return [oid(req.query.branch)];
  }
  return req.allBranches ? null : req.branchIds.map(oid);
};

/**
 * Owner dashboard (final goal of the requirement):
 * today's booking, dispatch, unloading, delivery, freight — per branch and total,
 * plus what is pending right now.
 */
export const dashboard = ah(async (req, res) => {
  const { start, end } = dayRange(req.query.from, req.query.to);
  const ids = visibleBranchIds(req);
  const inB = (f) => (ids ? { [f]: { $in: ids } } : {});
  const branches = await Branch.find(ids ? { _id: { $in: ids } } : { active: { $ne: false } }).select('name code type').sort({ type: 1, name: 1 }).lean();

  const [booked, dispatched, unloaded, delivered, pending] = await Promise.all([
    LR.aggregate([
      { $match: { lrDate: { $gte: start, $lte: end }, status: { $ne: 'cancelled' }, ...inB('bookingBranch') } },
      { $group: { _id: '$bookingBranch', lrs: { $sum: 1 }, nag: { $sum: '$totalNag' }, weight: { $sum: '$totalWeight' }, freight: { $sum: '$freight.total' }, paid: { $sum: { $cond: [{ $eq: ['$paymentType', 'paid'] }, '$freight.total', 0] } } } },
    ]),
    Challan.aggregate([
      { $match: { dispatchedAt: { $gte: start, $lte: end }, status: { $ne: 'cancelled' }, ...inB('fromBranch') } },
      { $group: { _id: '$fromBranch', challans: { $sum: 1 }, lrs: { $sum: { $size: '$lines' } }, nag: { $sum: '$totalNag' }, weight: { $sum: '$totalWeight' } } },
    ]),
    Challan.aggregate([
      { $match: ids ? { toBranch: { $in: ids } } : {} },
      { $unwind: '$lines' },
      { $match: { 'lines.unloadedAt': { $gte: start, $lte: end } } },
      { $group: { _id: '$toBranch', lrs: { $sum: 1 }, nag: { $sum: '$lines.receivedNag' }, short: { $sum: '$lines.shortNag' }, damaged: { $sum: '$lines.damagedNag' } } },
    ]),
    LR.aggregate([
      { $match: { 'delivery.at': { $gte: start, $lte: end }, status: 'delivered', ...inB('deliveryBranch') } },
      { $group: { _id: '$deliveryBranch', lrs: { $sum: 1 }, nag: { $sum: '$delivery.deliveredNag' }, collected: { $sum: '$delivery.collectedAmount' } } },
    ]),
    LR.aggregate([
      { $match: { status: { $in: ['booked', 'in_transit', 'at_branch', 'arrived'] }, ...(ids ? { $or: [{ currentBranch: { $in: ids } }, { deliveryBranch: { $in: ids } }] } : {}) } },
      { $group: { _id: { s: '$status', b: { $cond: [{ $eq: ['$status', 'in_transit'] }, '$deliveryBranch', '$currentBranch'] } }, lrs: { $sum: 1 }, nag: { $sum: '$totalNag' } } },
    ]),
  ]);

  // money (phase 2): billing + receipts in range, outstanding now – by branch that raised the bill / receipt
  const [billed, received, owed] = await Promise.all([
    Bill.aggregate([
      { $match: { billDate: { $gte: start, $lte: end }, status: { $ne: 'cancelled' }, ...inB('branch') } },
      { $group: { _id: '$branch', bills: { $sum: 1 }, amount: { $sum: '$total' } } },
    ]),
    Receipt.aggregate([
      { $match: { date: { $gte: start, $lte: end }, status: 'active', ...inB('branch') } },
      { $group: { _id: '$branch', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
    Bill.aggregate([
      { $match: { status: { $in: ['unpaid', 'partial'] }, ...inB('branch') } },
      { $group: { _id: '$branch', amount: { $sum: '$balance' }, overdue: { $sum: { $cond: [{ $lt: ['$dueDate', new Date()] }, '$balance', 0] } } } },
    ]),
  ]);
  const by = (arr) => Object.fromEntries(arr.map((r) => [String(r._id), r]));
  const BL = by(billed), RC = by(received), OW = by(owed);
  const B = by(booked), D = by(dispatched), U = by(unloaded), L = by(delivered);
  const P = {};
  for (const p of pending) {
    const k = String(p._id.b);
    P[k] = P[k] || {};
    P[k][p._id.s] = { lrs: p.lrs, nag: p.nag };
  }
  const zero = { lrs: 0, nag: 0, weight: 0, freight: 0, paid: 0, challans: 0, collected: 0, short: 0, damaged: 0 };
  const rows = branches.map((b) => {
    const k = String(b._id);
    return {
      branch: b,
      booked: { ...zero, ...B[k] },
      dispatched: { ...zero, ...D[k] },
      unloaded: { ...zero, ...U[k] },
      delivered: { ...zero, ...L[k] },
      money: {
        billed: BL[k]?.amount || 0,
        bills: BL[k]?.bills || 0,
        received: RC[k]?.amount || 0,
        outstanding: OW[k]?.amount || 0,
        overdue: OW[k]?.overdue || 0,
      },
      pending: {
        toDispatch: (P[k]?.booked?.lrs || 0) + (P[k]?.at_branch?.lrs || 0),
        incoming: P[k]?.in_transit?.lrs || 0,
        toDeliver: P[k]?.arrived?.lrs || 0,
      },
    };
  });
  const sum = (path) => rows.reduce((s, r) => s + (path(r) || 0), 0);
  const totals = {
    bookings: sum((r) => r.booked.lrs),
    bookedNag: sum((r) => r.booked.nag),
    freight: sum((r) => r.booked.freight),
    dispatchedLrs: sum((r) => r.dispatched.lrs),
    challans: sum((r) => r.dispatched.challans),
    unloadedLrs: sum((r) => r.unloaded.lrs),
    shortNag: sum((r) => r.unloaded.short),
    damagedNag: sum((r) => r.unloaded.damaged),
    deliveredLrs: sum((r) => r.delivered.lrs),
    collected: sum((r) => r.delivered.collected),
    toDispatch: sum((r) => r.pending.toDispatch),
    inTransit: sum((r) => r.pending.incoming),
    toDeliver: sum((r) => r.pending.toDeliver),
    billed: sum((r) => r.money.billed),
    received: sum((r) => r.money.received),
    outstanding: sum((r) => r.money.outstanding),
    overdue: sum((r) => r.money.overdue),
  };

  // 7-day booking trend
  const weekStart = new Date(end);
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);
  const trend = await LR.aggregate([
    { $match: { lrDate: { $gte: weekStart, $lte: end }, status: { $ne: 'cancelled' }, ...inB('bookingBranch') } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$lrDate', timezone: 'Asia/Kolkata' } }, lrs: { $sum: 1 }, freight: { $sum: '$freight.total' } } },
    { $sort: { _id: 1 } },
  ]);
  ok(res, { range: { start, end }, totals, rows, trend });
});

// Pending lists the requirement asks for
export const pendingReport = ah(async (req, res) => {
  const ids = visibleBranchIds(req);
  const type = req.query.type; // dispatch | unloading | delivery
  let filter;
  if (type === 'dispatch') filter = { status: { $in: ['booked', 'at_branch'] }, ...(ids ? { currentBranch: { $in: ids } } : {}) };
  else if (type === 'unloading') filter = { status: 'in_transit', ...(ids ? { deliveryBranch: { $in: ids } } : {}) };
  else filter = { status: 'arrived', ...(ids ? { deliveryBranch: { $in: ids } } : {}) };
  const items = await LR.find(filter)
    .select('lrNo lrDate consignor.name consignee.name consignee.mobile totalNag totalWeight status paymentType freight.total updatedAt currentChallan')
    .populate('bookingBranch deliveryBranch currentBranch', 'name code')
    .populate('currentChallan', 'challanNo vehicleNo dispatchedAt')
    .sort({ lrDate: 1 })
    .limit(1000)
    .lean();
  const now = Date.now();
  ok(res, { items: items.map((i) => ({ ...i, ageDays: Math.floor((now - new Date(i.lrDate)) / 86400000) })), total: items.length });
});

// Branch-wise inward / outward between dates
export const branchMovement = ah(async (req, res) => {
  const { start, end } = dayRange(req.query.from, req.query.to);
  const ids = visibleBranchIds(req);
  const [out, inn] = await Promise.all([
    Challan.aggregate([
      { $match: { dispatchedAt: { $gte: start, $lte: end }, status: { $ne: 'cancelled' }, ...(ids ? { fromBranch: { $in: ids } } : {}) } },
      { $group: { _id: { from: '$fromBranch', to: '$toBranch' }, challans: { $sum: 1 }, nag: { $sum: '$totalNag' }, weight: { $sum: '$totalWeight' }, hire: { $sum: '$lorryHire' } } },
    ]),
    Challan.aggregate([
      { $match: { arrivedAt: { $gte: start, $lte: end }, ...(ids ? { toBranch: { $in: ids } } : {}) } },
      { $group: { _id: { from: '$fromBranch', to: '$toBranch' }, challans: { $sum: 1 }, nag: { $sum: '$totalNag' }, weight: { $sum: '$totalWeight' } } },
    ]),
  ]);
  const branches = Object.fromEntries((await Branch.find().select('name code').lean()).map((b) => [String(b._id), b]));
  const name = (r) => ({ ...r, from: branches[String(r._id.from)], to: branches[String(r._id.to)] });
  ok(res, { outward: out.map(name), inward: inn.map(name) });
});

export const claims = ah(async (req, res) => {
  const ids = visibleBranchIds(req);
  const filter = { ...(ids ? { branch: { $in: ids } } : {}) };
  if (req.query.status) filter.status = req.query.status;
  const items = await Claim.find(filter).populate('branch', 'name code').populate('challan', 'challanNo vehicleNo').sort({ createdAt: -1 }).limit(500).lean();
  ok(res, { items, total: items.length });
});

export const updateClaim = ah(async (req, res) => {
  const c = await Claim.findById(req.params.id);
  if (!c) return res.status(404).json({ success: false, message: 'Claim not found' });
  assertBranch(req, c.branch);
  for (const k of ['claimAmount', 'settledAmount', 'status', 'remark']) if (k in req.body) c[k] = req.body[k];
  await c.save();
  ok(res, c, 'Claim updated');
});

export const auditLog = ah(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.entity) filter.entity = req.query.entity;
  if (req.query.ref) filter.ref = req.query.ref;
  if (req.query.user) filter.user = req.query.user;
  const [items, total] = await Promise.all([
    AuditLog.find(filter).populate('branch', 'code').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  ok(res, { items, total, page, limit });
});

export const notifications = ah(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = req.query.status ? { status: req.query.status } : {};
  const [items, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
  ]);
  ok(res, { items, total, page, limit });
});

export const branchAlerts = ah(async (req, res) => {
  const ids = visibleBranchIds(req);
  const items = await BranchAlert.find(ids ? { branch: { $in: ids } } : {}).populate('branch', 'code').sort({ createdAt: -1 }).limit(30).lean();
  ok(res, { items, unread: items.filter((i) => !i.read).length });
});

export const markAlertsRead = ah(async (req, res) => {
  const ids = visibleBranchIds(req);
  await BranchAlert.updateMany({ ...(ids ? { branch: { $in: ids } } : {}), read: false }, { read: true });
  ok(res, null, 'Marked read');
});
