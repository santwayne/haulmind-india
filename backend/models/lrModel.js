import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

/**
 * LR (Lorry Receipt / Bilty) – the heart of the system.
 *
 * Status flow
 *   booked      → at booking branch, waiting for dispatch
 *   in_transit  → loaded on a dispatch / transfer challan
 *   at_branch   → unloaded at an intermediate branch (e.g. reached Ludhiana hub, final is Jalandhar)
 *   arrived     → unloaded at the delivery branch, ready for delivery
 *   delivered   → handed to consignee (DC + POD)
 *   cancelled
 */
export const LR_STATUSES = ['booked', 'in_transit', 'at_branch', 'arrived', 'delivered', 'cancelled'];

const partySnap = {
  party: { type: ObjectId, ref: 'Party' },
  name: { type: String, required: true },
  mobile: String,
  address: String,
  gstin: String,
};

const itemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true }, // माल का नाम
    packing: String, // carton / bale / bag
    nag: { type: Number, default: 0 }, // नग
    actualWeight: { type: Number, default: 0 },
    chargedWeight: { type: Number, default: 0 },
    quantity: String, // free text if needed
  },
  { _id: false }
);

const historySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    status: String,
    branch: { type: ObjectId, ref: 'Branch' },
    note: String,
    by: { type: ObjectId, ref: 'User' },
    ref: String, // challan / DC number
  },
  { _id: false }
);

const lrSchema = new mongoose.Schema(
  {
    lrNo: { type: String, required: true, unique: true },
    lrDate: { type: Date, default: Date.now },
    bookingBranch: { type: ObjectId, ref: 'Branch', required: true },
    deliveryBranch: { type: ObjectId, ref: 'Branch', required: true },
    currentBranch: { type: ObjectId, ref: 'Branch' },
    consignor: partySnap,
    consignee: partySnap,
    billingParty: { type: ObjectId, ref: 'Party' }, // who pays (for TBB)
    broker: { type: ObjectId, ref: 'Broker' },
    items: { type: [itemSchema], validate: (v) => v.length > 0 },
    totalNag: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
    invoiceNo: String,
    invoiceValue: Number,
    ewayBillNo: String,
    paymentType: { type: String, enum: ['paid', 'to_pay', 'tbb'], default: 'to_pay' },
    freight: {
      basis: { type: String, enum: ['weight', 'nag', 'fixed'], default: 'weight' },
      rate: { type: Number, default: 0 },
      basicFreight: { type: Number, default: 0 },
      biltyCharge: { type: Number, default: 0 },
      hamali: { type: Number, default: 0 },
      doorDelivery: { type: Number, default: 0 },
      otherCharges: { type: Number, default: 0 },
      gstPercent: { type: Number, default: 0 },
      gstAmount: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    deliveryType: { type: String, enum: ['godown', 'door'], default: 'godown' },
    remarks: String,
    status: { type: String, enum: LR_STATUSES, default: 'booked', index: true },
    currentChallan: { type: ObjectId, ref: 'Challan' },
    // Unloading result at the delivery branch
    received: {
      nag: Number,
      shortNag: { type: Number, default: 0 },
      damagedNag: { type: Number, default: 0 },
      remark: String,
      at: Date,
    },
    delivery: {
      dcNo: String,
      at: Date,
      receiverName: String,
      receiverMobile: String,
      deliveredNag: Number,
      collectedAmount: { type: Number, default: 0 }, // to_pay freight collected at delivery
      collectionMode: { type: String, enum: ['cash', 'bank', 'upi', 'cheque', 'none'], default: 'none' },
      podFiles: [String],
      signature: String, // data URL from signature pad
      remark: String,
      by: { type: ObjectId, ref: 'User' },
    },
    billed: { type: Boolean, default: false },
    bill: { type: ObjectId, ref: 'Bill' },
    brokerCommission: { type: Number, default: 0 },
    migratedFrom: String, // "vouch" for imported records
    history: [historySchema],
    createdBy: { type: ObjectId, ref: 'User' },
    cancelReason: String,
  },
  { timestamps: true }
);

lrSchema.index({ bookingBranch: 1, lrDate: -1 });
lrSchema.index({ deliveryBranch: 1, status: 1 });
lrSchema.index({ currentBranch: 1, status: 1 });
lrSchema.index({ 'consignor.mobile': 1 });
lrSchema.index({ 'consignee.mobile': 1 });
lrSchema.index({ billingParty: 1, billed: 1 });

export const LR = mongoose.model('LR', lrSchema);
