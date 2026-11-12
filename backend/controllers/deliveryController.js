import { LR } from '../models/lrModel.js';
import { ah, ok, AppError } from '../utils/http.js';
import { assertBranch } from '../middleware/authRoles.js';
import { nextNumber } from '../services/numbering.js';
import { audit } from '../services/auditService.js';
import { notify } from '../services/notificationService.js';
import { dcPdf } from '../services/pdfService.js';
import { Branch } from '../models/masterModels.js';

/**
 * Delivery (point 6). multipart/form-data:
 *   receiverName*, receiverMobile, deliveredNag, collectedAmount, collectionMode, remark,
 *   signature (data URL), pod (files, up to 5 photos/PDF)
 * Only LRs in "arrived" status at their delivery branch; an LR can be delivered once.
 */
export const deliverLR = ah(async (req, res) => {
  const lr = await LR.findById(req.params.id);
  if (!lr) throw new AppError(404, 'LR not found');
  assertBranch(req, lr.deliveryBranch);
  if (lr.status === 'delivered') throw new AppError(409, `LR ${lr.lrNo} is already delivered (DC ${lr.delivery?.dcNo})`);
  if (lr.status !== 'arrived') throw new AppError(400, `LR ${lr.lrNo} has not arrived at the delivery branch yet (status: ${lr.status})`);

  const b = req.body || {};
  if (!b.receiverName) throw new AppError(400, 'Receiver name is required');
  if (lr.paymentType === 'to_pay' && !Number(b.collectedAmount) && b.allowCredit !== 'true') {
    throw new AppError(400, `This is a TO PAY LR – collect ₹${lr.freight.total} or mark allowCredit`);
  }
  const branch = await Branch.findById(lr.deliveryBranch);
  const dcNo = await nextNumber('DC', branch.code);
  const pod = (req.files || []).map((f) => `/uploads/pod/${f.filename}`);
  const delivery = {
    dcNo,
    at: new Date(),
    receiverName: b.receiverName,
    receiverMobile: b.receiverMobile,
    deliveredNag: b.deliveredNag != null && b.deliveredNag !== '' ? Number(b.deliveredNag) : lr.received?.nag ?? lr.totalNag,
    collectedAmount: Number(b.collectedAmount) || 0,
    collectionMode: b.collectionMode || (Number(b.collectedAmount) ? 'cash' : 'none'),
    podFiles: pod,
    signature: b.signature,
    remark: b.remark,
    by: req.user._id,
  };
  // conditional update = no double delivery even if two clerks click together
  const upd = await LR.findOneAndUpdate(
    { _id: lr._id, status: 'arrived' },
    {
      status: 'delivered',
      delivery,
      $push: { history: { status: 'delivered', branch: lr.deliveryBranch, by: req.user._id, ref: dcNo, note: `Delivered to ${b.receiverName}` } },
    },
    { new: true }
  );
  if (!upd) throw new AppError(409, 'LR was delivered by someone else just now');
  await audit(req, { action: 'status', entity: 'LR', entityId: lr._id, ref: lr.lrNo, branch: lr.deliveryBranch, changes: { status: { from: 'arrived', to: 'delivered' }, dcNo, collected: delivery.collectedAmount } });
  notify({
    event: 'lr_delivered', mobile: lr.consignor.mobile, lr: lr._id, party: lr.consignor.party,
    params: { lrNo: lr.lrNo, receiver: b.receiverName, dcNo },
  });
  ok(res, upd, `Delivered. DC ${dcNo}`);
});

// Add POD later (e.g. signed copy scanned next day)
export const addPod = ah(async (req, res) => {
  const lr = await LR.findById(req.params.id);
  if (!lr) throw new AppError(404, 'LR not found');
  assertBranch(req, lr.deliveryBranch);
  if (lr.status !== 'delivered') throw new AppError(400, 'POD can be added only after delivery');
  const pod = (req.files || []).map((f) => `/uploads/pod/${f.filename}`);
  if (!pod.length) throw new AppError(400, 'Attach a photo or PDF');
  lr.delivery.podFiles.push(...pod);
  await lr.save();
  await audit(req, { action: 'update', entity: 'LR', entityId: lr._id, ref: lr.lrNo, changes: { podAdded: pod } });
  ok(res, lr.delivery, 'POD added');
});

export const dcPdfCtl = ah(async (req, res) => {
  const lr = await LR.findById(req.params.id).populate('bookingBranch deliveryBranch', 'name code address phone');
  if (!lr || lr.status !== 'delivered') throw new AppError(404, 'No delivery challan for this LR');
  assertBranch(req, lr.deliveryBranch._id);
  const pdf = await dcPdf(lr.toObject());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${lr.delivery.dcNo}.pdf"`);
  res.send(pdf);
});
