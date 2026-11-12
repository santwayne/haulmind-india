import { Challan } from '../models/challanModel.js';
import { LR } from '../models/lrModel.js';
import { Branch, Vehicle } from '../models/masterModels.js';
import { BranchAlert, Claim } from '../models/systemModels.js';
import { ah, ok, AppError, paginate, escapeRegex } from '../utils/http.js';
import { assertBranch, branchFilter } from '../middleware/authRoles.js';
import { nextNumber } from '../services/numbering.js';
import { audit } from '../services/auditService.js';
import { notify } from '../services/notificationService.js';
import { challanPdf } from '../services/pdfService.js';

const POP = [
  { path: 'fromBranch', select: 'name code address phone' },
  { path: 'toBranch', select: 'name code' },
  { path: 'lines.lr', select: 'lrNo consignor consignee deliveryBranch totalNag totalWeight status paymentType freight.total' },
];

/** LRs sitting at a branch that can be loaded (booked here, or unloaded here in transit) */
export const loadable = ah(async (req, res) => {
  const branch = req.query.branch;
  if (!branch) throw new AppError(400, 'branch is required');
  assertBranch(req, branch);
  const filter = { currentBranch: branch, status: { $in: ['booked', 'at_branch'] } };
  if (req.query.toBranch) filter.deliveryBranch = req.query.toBranch;
  const items = await LR.find(filter)
    .select('lrNo lrDate consignor.name consignee.name deliveryBranch totalNag totalWeight status paymentType')
    .populate('deliveryBranch', 'name code')
    .sort({ lrDate: 1 })
    .lean();
  ok(res, { items, total: items.length });
});

/**
 * Create a dispatch / transfer challan with many LRs (point 3 + 5).
 * Duplicate protection: each LR is moved with a conditional update
 * (must still be booked/at_branch AND at this branch), so the same LR
 * can never sit on two challans.
 */
export const createChallan = ah(async (req, res) => {
  const b = req.body || {};
  assertBranch(req, b.fromBranch);
  if (!b.lrIds?.length) throw new AppError(400, 'Select at least one LR');
  if (String(b.fromBranch) === String(b.toBranch)) throw new AppError(400, 'From and To branch cannot be the same');
  const [from, to] = await Promise.all([Branch.findById(b.fromBranch), Branch.findById(b.toBranch)]);
  if (!from || !to) throw new AppError(400, 'Invalid branch');

  let vehicle = null;
  if (b.vehicleNo) {
    vehicle = await Vehicle.findOneAndUpdate(
      { number: String(b.vehicleNo).toUpperCase().replace(/\s+/g, '') },
      { $setOnInsert: { driverName: b.driverName, driverMobile: b.driverMobile, type: 'hired' } },
      { upsert: true, new: true }
    );
  }

  const lrs = await LR.find({ _id: { $in: b.lrIds } }).lean();
  if (lrs.length !== b.lrIds.length) throw new AppError(400, 'Some LRs were not found');
  const bad = lrs.filter((l) => String(l.currentBranch) !== String(from._id) || !['booked', 'at_branch'].includes(l.status));
  if (bad.length) throw new AppError(409, `These LRs are not available at ${from.name}: ${bad.map((l) => l.lrNo).join(', ')}`);

  // decide type automatically: transfer if any LR is not going to its final branch
  const type = b.type || (lrs.every((l) => String(l.deliveryBranch) === String(to._id)) && lrs.every((l) => l.status === 'booked') ? 'dispatch' : 'transfer');
  const challanNo = await nextNumber(type === 'transfer' ? 'TR' : 'CH', from.code);
  const challan = await Challan.create({
    challanNo,
    type,
    fromBranch: from._id,
    toBranch: to._id,
    vehicle: vehicle?._id,
    vehicleNo: vehicle?.number || b.vehicleNo,
    driverName: b.driverName,
    driverMobile: b.driverMobile,
    transporter: b.transporter,
    lorryHire: b.lorryHire || 0,
    advancePaid: b.advancePaid || 0,
    dispatchedAt: b.dispatchedAt || new Date(),
    expectedAt: b.expectedAt,
    lines: lrs.map((l) => ({ lr: l._id, lrNo: l.lrNo, nag: l.totalNag, weight: l.totalWeight })),
    totalNag: lrs.reduce((s, l) => s + l.totalNag, 0),
    totalWeight: lrs.reduce((s, l) => s + l.totalWeight, 0),
    remarks: b.remarks,
    createdBy: req.user._id,
  });

  const moved = [];
  for (const l of lrs) {
    const r = await LR.updateOne(
      { _id: l._id, currentBranch: from._id, status: { $in: ['booked', 'at_branch'] } },
      {
        status: 'in_transit',
        currentChallan: challan._id,
        $push: { history: { status: 'in_transit', branch: from._id, by: req.user._id, ref: challanNo, note: `Loaded on ${challan.vehicleNo || 'vehicle'} for ${to.name}` } },
      }
    );
    if (r.modifiedCount) moved.push(l._id);
  }
  if (moved.length !== lrs.length) {
    // someone else loaded an LR at the same moment – roll back this challan
    for (const id of moved) {
      const prev = lrs.find((l) => String(l._id) === String(id)).status;
      await LR.updateOne({ _id: id, currentChallan: challan._id }, { status: prev, $unset: { currentChallan: 1 }, $pop: { history: 1 } });
    }
    await Challan.deleteOne({ _id: challan._id });
    throw new AppError(409, 'One of the LRs was just loaded on another challan. Refresh and try again.');
  }

  await BranchAlert.create({
    branch: to._id,
    title: `${challan.vehicleNo || 'Vehicle'} dispatched from ${from.name}`,
    body: `${challanNo}: ${lrs.length} LR, ${challan.totalNag} nag, ${challan.totalWeight} kg`,
    link: `/unloading/${challan._id}`,
  });
  await audit(req, { action: 'create', entity: 'Challan', entityId: challan._id, ref: challanNo, branch: from._id, changes: { type, to: to.code, lrs: lrs.length } });
  ok(res, await Challan.findById(challan._id).populate(POP).lean(), `${challanNo} created`, 201);
});

export const listChallans = ah(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const dir = req.query.direction; // outgoing | incoming
  const fields = dir === 'incoming' ? ['toBranch'] : dir === 'outgoing' ? ['fromBranch'] : ['fromBranch', 'toBranch'];
  const filter = { ...branchFilter(req, fields) };
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  if (req.query.type) filter.type = req.query.type;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$and = [{ $or: [{ challanNo: rx }, { vehicleNo: rx }, { 'lines.lrNo': rx }] }];
  }
  const [items, total] = await Promise.all([
    Challan.find(filter).select('-lines.damageRemark').populate('fromBranch toBranch', 'name code').sort({ dispatchedAt: -1 }).skip(skip).limit(limit).lean(),
    Challan.countDocuments(filter),
  ]);
  ok(res, { items, total, page, limit });
});

const loadChallan = async (req, id) => {
  const ch = await Challan.findById(id).populate(POP);
  if (!ch) throw new AppError(404, 'Challan not found');
  const ids = [String(ch.fromBranch._id), String(ch.toBranch._id)];
  if (!req.allBranches && !ids.some((x) => req.branchIds.includes(x))) throw new AppError(403, 'This challan is not in your branch');
  return ch;
};

export const getChallan = ah(async (req, res) => ok(res, (await loadChallan(req, req.params.id)).toObject()));

/**
 * Unloading (point 4). Body: { lines: [{ lr, receivedNag, damagedNag, damageRemark }] }
 * Lines not sent stay "not unloaded" → appear in the not-unloaded report.
 * Each LR line can be unloaded only once.
 */
export const unloadChallan = ah(async (req, res) => {
  const ch = await loadChallan(req, req.params.id);
  assertBranch(req, ch.toBranch._id);
  if (['received', 'cancelled'].includes(ch.status)) throw new AppError(400, `Challan already ${ch.status}`);
  const input = req.body?.lines || [];
  if (!input.length) throw new AppError(400, 'Nothing to unload');

  const done = [];
  for (const row of input) {
    const line = ch.lines.find((l) => String(l.lr._id || l.lr) === String(row.lr));
    if (!line) throw new AppError(400, `LR ${row.lr} is not on this challan`);
    if (line.unloaded) continue; // duplicate entry protection
    const received = row.receivedNag == null ? line.nag : Number(row.receivedNag);
    if (received < 0 || received > line.nag) throw new AppError(400, `${line.lrNo}: received nag must be between 0 and ${line.nag}`);
    const damaged = Math.min(Number(row.damagedNag) || 0, received);
    line.unloaded = true;
    line.receivedNag = received;
    line.shortNag = line.nag - received;
    line.damagedNag = damaged;
    line.damageRemark = row.damageRemark;
    line.unloadedAt = new Date();
    done.push({ line, row });
  }
  const allDone = ch.lines.every((l) => l.unloaded);
  ch.status = allDone ? 'received' : 'partially_received';
  ch.arrivedAt = ch.arrivedAt || new Date();
  ch.unloadedBy = req.user._id;
  await ch.save();

  const toBranch = ch.toBranch;
  for (const { line } of done) {
    const lrId = line.lr._id || line.lr;
    const lr = await LR.findById(lrId);
    const final = String(lr.deliveryBranch) === String(toBranch._id);
    const status = final ? 'arrived' : 'at_branch';
    const note = [
      `Unloaded at ${toBranch.name}: ${line.receivedNag}/${line.nag} nag`,
      line.shortNag ? `${line.shortNag} short` : '',
      line.damagedNag ? `${line.damagedNag} damaged` : '',
    ].filter(Boolean).join(', ');
    await LR.updateOne(
      { _id: lrId, currentChallan: ch._id, status: 'in_transit' },
      {
        status,
        currentBranch: toBranch._id,
        $unset: { currentChallan: 1 },
        ...(final ? { received: { nag: line.receivedNag, shortNag: line.shortNag, damagedNag: line.damagedNag, remark: line.damageRemark, at: line.unloadedAt } } : {}),
        $push: { history: { status, branch: toBranch._id, by: req.user._id, ref: ch.challanNo, note } },
      }
    );
    if (line.shortNag) await Claim.create({ lr: lrId, lrNo: line.lrNo, challan: ch._id, branch: toBranch._id, type: 'short', nag: line.shortNag, remark: line.damageRemark, createdBy: req.user._id });
    if (line.damagedNag) await Claim.create({ lr: lrId, lrNo: line.lrNo, challan: ch._id, branch: toBranch._id, type: 'damage', nag: line.damagedNag, remark: line.damageRemark, createdBy: req.user._id });
    if (final) {
      notify({
        event: 'lr_unloaded', mobile: lr.consignee.mobile, lr: lr._id, party: lr.consignee.party,
        params: { lrNo: lr.lrNo, branch: toBranch.name, nag: line.receivedNag },
      });
    }
  }
  await audit(req, { action: 'status', entity: 'Challan', entityId: ch._id, ref: ch.challanNo, branch: toBranch._id, changes: { unloaded: done.map((d) => d.line.lrNo), status: ch.status } });
  ok(res, (await loadChallan(req, ch._id)).toObject(), `${done.length} LR unloaded`);
});

// Cancel only if nothing has been unloaded yet; LRs go back to the sending branch
export const cancelChallan = ah(async (req, res) => {
  const ch = await loadChallan(req, req.params.id);
  assertBranch(req, ch.fromBranch._id);
  if (ch.status !== 'in_transit' || ch.lines.some((l) => l.unloaded)) throw new AppError(400, 'Challan already (partly) unloaded – cannot cancel');
  for (const l of ch.lines) {
    const lr = await LR.findById(l.lr._id || l.lr);
    // previous status = booked if this is its booking branch, else at_branch
    const back = String(lr.bookingBranch) === String(ch.fromBranch._id) ? 'booked' : 'at_branch';
    await LR.updateOne(
      { _id: lr._id, currentChallan: ch._id },
      { status: back, $unset: { currentChallan: 1 }, $push: { history: { status: back, branch: ch.fromBranch._id, by: req.user._id, ref: ch.challanNo, note: 'Challan cancelled, goods back at branch' } } }
    );
  }
  ch.status = 'cancelled';
  ch.remarks = [ch.remarks, `Cancelled: ${req.body?.reason || ''}`].filter(Boolean).join(' | ');
  await ch.save();
  await audit(req, { action: 'cancel', entity: 'Challan', entityId: ch._id, ref: ch.challanNo, branch: ch.fromBranch._id, changes: { reason: req.body?.reason } });
  ok(res, null, `${ch.challanNo} cancelled`);
});

export const challanPdfCtl = ah(async (req, res) => {
  const ch = await loadChallan(req, req.params.id);
  const pdf = await challanPdf(ch.toObject());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${ch.challanNo}.pdf"`);
  res.send(pdf);
});
