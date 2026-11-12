import { LR } from '../models/lrModel.js';
import { Branch, Party } from '../models/masterModels.js';
import { ah, ok, AppError, paginate, escapeRegex } from '../utils/http.js';
import { assertBranch, branchFilter } from '../middleware/authRoles.js';
import { nextNumber } from '../services/numbering.js';
import { computeFreight, itemTotals, findRate } from '../services/freightService.js';
import { audit } from '../services/auditService.js';
import { notify } from '../services/notificationService.js';
import { lrPdf } from '../services/pdfService.js';
import { config } from '../config/config.js';
import { creditCheck, syncCommission } from '../services/accountService.js';

const POP = [
  { path: 'bookingBranch', select: 'name code address phone' },
  { path: 'deliveryBranch', select: 'name code address phone' },
  { path: 'currentBranch', select: 'name code' },
  { path: 'broker', select: 'name' },
  { path: 'history.branch', select: 'name code' },
  { path: 'history.by', select: 'name' },
];

// Find or create the party master from what was typed on the booking form
const upsertParty = async (snap, branchId) => {
  if (!snap?.name) throw new AppError(400, 'Consignor and consignee name are required');
  if (snap.party) {
    const p = await Party.findById(snap.party).lean();
    if (p) return { party: p._id, name: snap.name || p.name, mobile: snap.mobile || p.mobile, address: snap.address || p.address, gstin: snap.gstin || p.gstin };
  }
  let p = snap.mobile ? await Party.findOne({ mobile: snap.mobile, name: new RegExp(`^${escapeRegex(snap.name)}$`, 'i') }) : null;
  if (!p) p = await Party.create({ name: snap.name, mobile: snap.mobile, address: snap.address, gstin: snap.gstin, homeBranch: branchId });
  return { party: p._id, name: snap.name, mobile: snap.mobile, address: snap.address, gstin: snap.gstin };
};

export const rateLookup = ah(async (req, res) => {
  const { fromBranch, toBranch, party } = req.query;
  ok(res, await findRate({ fromBranch, toBranch, partyId: party }));
});

export const createLR = ah(async (req, res) => {
  const b = req.body || {};
  assertBranch(req, b.bookingBranch);
  const [bk, dl] = await Promise.all([Branch.findById(b.bookingBranch), Branch.findById(b.deliveryBranch)]);
  if (!bk || !dl) throw new AppError(400, 'Booking and delivery branch are required');
  if (!Array.isArray(b.items) || !b.items.length) throw new AppError(400, 'Add at least one item');

  const consignor = await upsertParty(b.consignor, bk._id);
  const consignee = await upsertParty(b.consignee, dl._id);
  const totals = itemTotals(b.items);
  const freight = computeFreight(b.freight, totals);
  const billingParty = b.billingParty || (b.paymentType === 'tbb' ? consignor.party : b.paymentType === 'to_pay' ? consignee.party : consignor.party);
  const warning = b.paymentType === 'tbb' && billingParty ? await creditCheck(billingParty, freight.total) : null;
  if (warning && b.overrideCredit !== true && !['owner', 'admin', 'branch_manager'].includes(req.user.role)) {
    throw new AppError(409, warning + '. Ask the branch manager to approve.', { code: 'CREDIT_LIMIT' });
  }

  const lrNo = b.lrNo && b.migratedFrom ? b.lrNo : await nextNumber('LR', bk.code, b.lrDate ? new Date(b.lrDate) : new Date());
  const lr = await LR.create({
    lrNo,
    lrDate: b.lrDate || new Date(),
    bookingBranch: bk._id,
    deliveryBranch: dl._id,
    currentBranch: bk._id,
    consignor,
    consignee,
    billingParty,
    broker: b.broker || undefined,
    items: b.items,
    totalNag: totals.nag,
    totalWeight: totals.weight,
    invoiceNo: b.invoiceNo,
    invoiceValue: b.invoiceValue,
    ewayBillNo: b.ewayBillNo,
    paymentType: b.paymentType || 'to_pay',
    freight,
    deliveryType: b.deliveryType || 'godown',
    remarks: b.remarks,
    createdBy: req.user._id,
    history: [{ status: 'booked', branch: bk._id, by: req.user._id, note: `Booked for ${dl.name}` }],
  });
  if (lr.broker) await syncCommission(lr, req.user._id);
  await audit(req, { action: 'create', entity: 'LR', entityId: lr._id, ref: lr.lrNo, branch: bk._id, changes: { total: freight.total, to: dl.code } });

  if (b.notifyConsignor !== false) {
    notify({
      event: 'lr_booked', mobile: consignor.mobile, lr: lr._id, party: consignor.party,
      params: { lrNo, nag: totals.nag, from: bk.name, to: dl.name, trackUrl: `${config.PUBLIC_TRACK_URL}?lr=${encodeURIComponent(lrNo)}` },
    });
  }
  ok(res, { lr: await LR.findById(lr._id).populate(POP).lean(), warning }, `LR ${lrNo} booked`, 201);
});

export const listLRs = ah(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const q = req.query;
  const scope = q.scope || 'booking'; // booking | delivery | current | any
  const fields = { booking: ['bookingBranch'], delivery: ['deliveryBranch'], current: ['currentBranch'], any: ['bookingBranch', 'deliveryBranch', 'currentBranch'] }[scope] || ['bookingBranch'];
  const filter = { ...branchFilter(req, fields) };
  if (q.status) filter.status = { $in: String(q.status).split(',') };
  if (q.paymentType) filter.paymentType = q.paymentType;
  if (q.from || q.to) {
    filter.lrDate = {};
    if (q.from) filter.lrDate.$gte = new Date(new Date(q.from).setHours(0, 0, 0, 0));
    if (q.to) filter.lrDate.$lte = new Date(new Date(q.to).setHours(23, 59, 59, 999));
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$and = [{ $or: [{ lrNo: rx }, { 'consignor.name': rx }, { 'consignee.name': rx }, { 'consignor.mobile': rx }, { 'consignee.mobile': rx }, { invoiceNo: rx }] }];
  }
  const [items, total, sums] = await Promise.all([
    LR.find(filter).select('-history -items').populate('bookingBranch deliveryBranch currentBranch', 'name code').sort({ lrDate: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    LR.countDocuments(filter),
    LR.aggregate([{ $match: filter }, { $group: { _id: null, nag: { $sum: '$totalNag' }, weight: { $sum: '$totalWeight' }, freight: { $sum: '$freight.total' } } }]),
  ]);
  ok(res, { items, total, page, limit, sums: sums[0] || { nag: 0, weight: 0, freight: 0 } });
});

const loadLR = async (req, id) => {
  const lr = await LR.findById(id).populate(POP);
  if (!lr) throw new AppError(404, 'LR not found');
  const ids = [lr.bookingBranch?._id, lr.deliveryBranch?._id, lr.currentBranch?._id].map(String);
  if (!req.allBranches && !ids.some((x) => req.branchIds.includes(x))) throw new AppError(403, 'This LR is not in your branch');
  return lr;
};

export const getLR = ah(async (req, res) => ok(res, (await loadLR(req, req.params.id)).toObject()));

export const findByNo = ah(async (req, res) => {
  const lr = await LR.findOne({ lrNo: String(req.params.lrNo).toUpperCase().trim() }).select('_id');
  if (!lr) throw new AppError(404, 'No LR with this number');
  ok(res, (await loadLR(req, lr._id)).toObject());
});

// Editing is allowed only before dispatch; every change is audit-logged
export const updateLR = ah(async (req, res) => {
  const lr = await loadLR(req, req.params.id);
  if (lr.status !== 'booked') throw new AppError(400, `LR is ${lr.status} – it can only be edited before dispatch`);
  if (lr.billed) throw new AppError(400, 'LR is already on a bill – cancel the bill first to edit it');
  assertBranch(req, lr.bookingBranch._id);
  const before = lr.toObject();
  const b = req.body || {};
  for (const k of ['invoiceNo', 'invoiceValue', 'ewayBillNo', 'paymentType', 'deliveryType', 'remarks', 'broker', 'billingParty']) if (k in b) lr[k] = b[k];
  if (b.deliveryBranch) lr.deliveryBranch = b.deliveryBranch;
  if (b.consignor) lr.consignor = await upsertParty(b.consignor, lr.bookingBranch._id);
  if (b.consignee) lr.consignee = await upsertParty(b.consignee, lr.deliveryBranch);
  if (b.items) lr.items = b.items;
  const totals = itemTotals(lr.items);
  lr.totalNag = totals.nag;
  lr.totalWeight = totals.weight;
  lr.freight = computeFreight(b.freight || lr.freight.toObject?.() || lr.freight, totals);
  lr.history.push({ status: lr.status, branch: lr.bookingBranch._id, by: req.user._id, note: 'LR edited' });
  await lr.save();
  await syncCommission(lr, req.user._id);
  await audit(req, { action: 'update', entity: 'LR', entityId: lr._id, ref: lr.lrNo, branch: lr.bookingBranch._id, before, after: lr.toObject() });
  ok(res, (await loadLR(req, lr._id)).toObject(), 'LR updated');
});

export const cancelLR = ah(async (req, res) => {
  const reason = req.body?.reason;
  if (!reason) throw new AppError(400, 'Give a reason for cancelling');
  const lr = await loadLR(req, req.params.id);
  assertBranch(req, lr.bookingBranch._id);
  const upd = await LR.findOneAndUpdate(
    { _id: lr._id, status: 'booked', billed: { $ne: true } },
    { status: 'cancelled', cancelReason: reason, $push: { history: { status: 'cancelled', branch: lr.bookingBranch._id, by: req.user._id, note: reason } } },
    { new: true }
  );
  if (!upd) throw new AppError(400, 'Only LRs not yet dispatched (and not billed) can be cancelled');
  await syncCommission(upd, req.user._id);
  await audit(req, { action: 'cancel', entity: 'LR', entityId: lr._id, ref: lr.lrNo, branch: lr.bookingBranch._id, changes: { reason } });
  ok(res, null, `LR ${lr.lrNo} cancelled`);
});

export const lrPdfCtl = ah(async (req, res) => {
  const lr = await loadLR(req, req.params.id);
  const copies = req.query.copy ? [String(req.query.copy).toUpperCase() + ' COPY'] : undefined;
  const pdf = await lrPdf(lr.toObject(), copies);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="LR-${lr.lrNo}.pdf"`);
  res.send(pdf);
});

// Public tracking – no amounts or phone numbers
export const publicTrack = ah(async (req, res) => {
  const lr = await LR.findOne({ lrNo: String(req.params.lrNo).toUpperCase().trim() })
    .populate('bookingBranch deliveryBranch currentBranch history.branch', 'name city')
    .lean();
  if (!lr) throw new AppError(404, 'No consignment found with this LR number');
  ok(res, {
    lrNo: lr.lrNo,
    lrDate: lr.lrDate,
    status: lr.status,
    from: lr.bookingBranch?.name,
    to: lr.deliveryBranch?.name,
    currentBranch: lr.currentBranch?.name,
    totalNag: lr.totalNag,
    consignor: lr.consignor.name,
    consignee: lr.consignee.name,
    deliveredAt: lr.delivery?.at,
    receiverName: lr.delivery?.receiverName,
    history: lr.history.map((h) => ({ at: h.at, status: h.status, branch: h.branch?.name, note: h.note })),
  });
});
